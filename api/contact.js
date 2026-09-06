const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const MAX_BODY_SIZE = 12000;

const recentRequests = new Map();


function sendJson(response, statusCode, body) {
    response.setHeader("Cache-Control", "no-store");
    response.status(statusCode).json(body);
}


function getClientIp(request) {
    const forwardedFor = request.headers["x-forwarded-for"];

    if (Array.isArray(forwardedFor)) {
        return forwardedFor[0] || "unknown";
    }

    if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
        return forwardedFor.split(",")[0].trim();
    }

    return request.socket?.remoteAddress || "unknown";
}


function isRateLimited(ipAddress) {
    const now = Date.now();
    const previousRequests = recentRequests.get(ipAddress) || [];
    const activeRequests = previousRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

    if (activeRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        recentRequests.set(ipAddress, activeRequests);
        return true;
    }

    activeRequests.push(now);
    recentRequests.set(ipAddress, activeRequests);

    if (recentRequests.size > 1000) {
        for (const [ip, timestamps] of recentRequests.entries()) {
            const stillActive = timestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

            if (stillActive.length === 0) {
                recentRequests.delete(ip);
            } else {
                recentRequests.set(ip, stillActive);
            }
        }
    }

    return false;
}


function cleanText(value) {
    return typeof value === "string" ? value.replace(/\0/g, "").trim() : "";
}


function cleanSubjectText(value) {
    return cleanText(value).replace(/[\r\n]+/g, " ").slice(0, 80);
}


function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


function isValidPhone(phone) {
    return phone === "" || /^[0-9+().\-\s]{7,30}$/.test(phone);
}


module.exports = async function handler(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return sendJson(response, 405, { message: "Method not allowed." });
    }

    const fetchSite = request.headers["sec-fetch-site"];

    if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
        return sendJson(response, 403, { message: "Request not allowed." });
    }

    const contentType = request.headers["content-type"] || "";

    if (!contentType.includes("application/json")) {
        return sendJson(response, 415, { message: "Invalid request format." });
    }

    const contentLength = Number(request.headers["content-length"] || 0);

    if (contentLength > MAX_BODY_SIZE) {
        return sendJson(response, 413, { message: "Your message is too large." });
    }

    let body = request.body;

    if (typeof body === "string") {
        try {
            body = JSON.parse(body);
        } catch {
            return sendJson(response, 400, { message: "Invalid request." });
        }
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(response, 400, { message: "Invalid request." });
    }

    if (JSON.stringify(body).length > MAX_BODY_SIZE) {
        return sendJson(response, 413, { message: "Your message is too large." });
    }

    const name = cleanText(body.name);
    const email = cleanText(body.email).toLowerCase();
    const phone = cleanText(body.phone);
    const message = cleanText(body.message);
    const website = cleanText(body.website);

    if (website !== "") {
        return sendJson(response, 200, { success: true });
    }

    if (name.length < 2 || name.length > 100) {
        return sendJson(response, 400, { message: "Please enter a valid name." });
    }

    if (email.length > 254 || !isValidEmail(email)) {
        return sendJson(response, 400, { message: "Please enter a valid email address." });
    }

    if (!isValidPhone(phone)) {
        return sendJson(response, 400, { message: "Please enter a valid phone number or leave it blank." });
    }

    if (message.length < 1 || message.length > 3000) {
        return sendJson(response, 400, { message: "Please enter a message between 1 and 3000 characters." });
    }

    const clientIp = getClientIp(request);

    if (isRateLimited(clientIp)) {
        return sendJson(response, 429, { message: "Too many messages have been submitted. Please wait a few minutes and try again." });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const contactToEmail = process.env.CONTACT_TO_EMAIL;
    const contactFromEmail = process.env.CONTACT_FROM_EMAIL;

    if (!resendApiKey || !contactToEmail || !contactFromEmail) {
        console.error("Contact form email environment variables are not configured.");
        return sendJson(response, 500, { message: "The contact form is temporarily unavailable. Please call us instead." });
    }

    const safeNameForSubject = cleanSubjectText(name);
    const submittedAt = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });

    const emailText = [
        "Flourish At Home Website Inquiry",
        "",
        'Name: ${name}',
        'Email: ${email}',
        'Phone: ${phone || "Not provided"}',
        'Submitted: ${submittedAt} (EST)',
        "",
        "Message:",
        message,
        "",
        "-----",
        "This message was sent through the Flourish At Home website contact form."
    ].join("\n");

    try {
        const resendResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": 'Bearer ${resendApiKey}',
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: contactFromEmail,
                to: [contactToEmail],
                reply_to: email,
                subject: 'Flourish At Home Inquiry - ${safeNameForSubject}',
                text: emailText
            })
        });

        if (!resendResponse.ok) {
            const resendError = await resendResponse.text();
            console.error("Resend email error:", resendResponse.status, resendError);
            return sendJson(response, 502, { message: "We could not send your message right now. Please try again or call us instead." });
        }

        return sendJson(response, 200, { success: true });
    } catch (error) {
        console.error("Contact form email error:", error);
        return sendJson(response, 500, { message: "We could not send your message right now. Please try again or call us instead." });
    }
};