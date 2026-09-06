const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const MAX_BODY_SIZE_BYTES = 12000;
const RESEND_TIMEOUT_MS = 10000;

const recentRequests = new Map();


function sendJson(response, statusCode, body) {
    response.setHeader("Cache-Control", "no-store");
    response.status(statusCode).json(body);
}


function getHeader(request, name) {
    const value = request.headers?.[name];

    if (Array.isArray(value)) {
        return value[0] || "";
    }

    return typeof value === "string" ? value : "";
}


function getClientIp(request) {
    const forwardedFor = getHeader(request, "x-forwarded-for");

    if (forwardedFor) {
        return forwardedFor.split(",")[0].trim() || null;
    }

    return request.socket?.remoteAddress || null;
}


function pruneRateLimitEntries(now = Date.now()) {
    for (const [ipAddress, requests] of recentRequests.entries()) {
        const activeRequests = requests.filter(entry => now - entry.timestamp < RATE_LIMIT_WINDOW_MS);

        if (activeRequests.length === 0) {
            recentRequests.delete(ipAddress);
        } else {
            recentRequests.set(ipAddress, activeRequests);
        }
    }
}


function reserveRateLimitSlot(ipAddress) {
    if (!ipAddress) {
        return {
            limited: false,
            reservation: null
        };
    }

    const now = Date.now();

    pruneRateLimitEntries(now);

    const activeRequests = recentRequests.get(ipAddress) || [];

    if (activeRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return {
            limited: true,
            reservation: null
        };
    }

    const reservation = {
        timestamp: now
    };

    activeRequests.push(reservation);
    recentRequests.set(ipAddress, activeRequests);

    return {
        limited: false,
        reservation: reservation
    };
}


function releaseRateLimitSlot(ipAddress, reservation) {
    if (!ipAddress || !reservation) {
        return;
    }

    const requests = recentRequests.get(ipAddress) || [];
    const remainingRequests = requests.filter(entry => entry !== reservation);

    if (remainingRequests.length === 0) {
        recentRequests.delete(ipAddress);
    } else {
        recentRequests.set(ipAddress, remainingRequests);
    }
}


function cleanSingleLine(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/[\u0000-\u001F\u007F]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function cleanMessage(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim();
}


function cleanSubjectText(value) {
    return cleanSingleLine(value).slice(0, 80);
}


function isValidEmail(email) {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


function isValidPhone(phone) {
    if (phone === "") {
        return true;
    }

    if (!/^[0-9+().\-\s]{7,30}$/.test(phone)) {
        return false;
    }

    const digitsOnly = phone.replace(/\D/g, "");

    return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}


function getSubmittedAt() {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
    }).format(new Date());
}


module.exports = async function handler(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");

        return sendJson(response, 405, {
            message: "Method not allowed."
        });
    }


    const fetchSite = getHeader(request, "sec-fetch-site");

    if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
        return sendJson(response, 403, {
            message: "Request not allowed."
        });
    }


    const contentType = getHeader(request, "content-type").toLowerCase();

    if (!contentType.includes("application/json")) {
        return sendJson(response, 415, {
            message: "Invalid request format."
        });
    }


    const contentLengthHeader = getHeader(request, "content-length");

    if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);

        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE_BYTES) {
            return sendJson(response, 413, {
                message: "Your message is too large."
            });
        }
    }


    let body = request.body;

    if (typeof body === "string") {
        try {
            body = JSON.parse(body);
        } catch {
            return sendJson(response, 400, {
                message: "Invalid request."
            });
        }
    }


    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(response, 400, {
            message: "Invalid request."
        });
    }


    let serializedBody;

    try {
        serializedBody = JSON.stringify(body);
    } catch {
        return sendJson(response, 400, {
            message: "Invalid request."
        });
    }


    if (Buffer.byteLength(serializedBody, "utf8") > MAX_BODY_SIZE_BYTES) {
        return sendJson(response, 413, {
            message: "Your message is too large."
        });
    }


    const name = cleanSingleLine(body.name);
    const email = cleanSingleLine(body.email);
    const phone = cleanSingleLine(body.phone);
    const message = cleanMessage(body.message);
    const website = cleanSingleLine(body.website);


    // Honeypot field. Real users never fill this out.
    if (website !== "") {
        return sendJson(response, 200, {
            success: true
        });
    }


    if (name.length < 1 || name.length > 100) {
        return sendJson(response, 400, {
            message: "Please enter a valid name."
        });
    }


    if (!isValidEmail(email)) {
        return sendJson(response, 400, {
            message: "Please enter a valid email address."
        });
    }


    if (!isValidPhone(phone)) {
        return sendJson(response, 400, {
            message: "Please enter a valid phone number or leave it blank."
        });
    }


    if (message.length < 1 || message.length > 3000) {
        return sendJson(response, 400, {
            message: "Please enter a message between 1 and 3000 characters."
        });
    }


    const resendApiKey = process.env.RESEND_API_KEY;
    const contactToEmail = process.env.CONTACT_TO_EMAIL;
    const contactFromEmail = process.env.CONTACT_FROM_EMAIL;


    if (!resendApiKey || !contactToEmail || !contactFromEmail) {
        console.error("Contact form email environment variables are not configured.");

        return sendJson(response, 500, {
            message: "The contact form is temporarily unavailable. Please call us instead."
        });
    }


    const clientIp = getClientIp(request);
    const rateLimit = reserveRateLimitSlot(clientIp);


    if (rateLimit.limited) {
        return sendJson(response, 429, {
            message: "Too many messages have been submitted. Please wait a few minutes and try again."
        });
    }


    const safeNameForSubject = cleanSubjectText(name);
    const submittedAt = getSubmittedAt();


    const emailText = [
        "Flourish At Home Website Inquiry",
        "",
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || "Not provided"}`,
        `Submitted: ${submittedAt}`,
        "",
        "Message:",
        message,
        "",
        "-----",
        "This message was sent through the Flourish At Home website contact form."
    ].join("\n");


    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
        controller.abort();
    }, RESEND_TIMEOUT_MS);


    try {
        const resendResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",

            headers: {
                "Authorization": `Bearer ${resendApiKey}`,
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                from: contactFromEmail,
                to: [contactToEmail],
                reply_to: email,
                subject: `Flourish At Home Inquiry - ${safeNameForSubject}`,
                text: emailText
            }),

            signal: controller.signal
        });


        if (!resendResponse.ok) {
            releaseRateLimitSlot(clientIp, rateLimit.reservation);

            const resendError = await resendResponse.text();

            console.error(
                "Resend email error:",
                resendResponse.status,
                resendError
            );

            return sendJson(response, 502, {
                message: "We could not send your message right now. Please try again or call us instead."
            });
        }


        return sendJson(response, 200, {
            success: true
        });


    } catch (error) {
        releaseRateLimitSlot(clientIp, rateLimit.reservation);


        if (error?.name === "AbortError") {
            console.error("Contact form email request timed out.");
        } else {
            console.error("Contact form email error:", error);
        }


        return sendJson(response, 500, {
            message: "We could not send your message right now. Please try again or call us instead."
        });


    } finally {
        clearTimeout(timeoutId);
    }
};