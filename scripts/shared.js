const pageContent = document.getElementById("page_content");
const pageStyle = document.getElementById("page_style");


async function loadPage(page) {
    const response = await fetch(`pages/content/${page}.html`);

    if (!response.ok) {
        console.error(`Could not load page: ${page}`);
        return;
    }

    const html = await response.text();
    const newStyle = `styles/${page}.css`;

    pageContent.style.visibility = "hidden";
    pageContent.innerHTML = "";

    if (pageStyle.getAttribute("href") === newStyle) {
        pageContent.innerHTML = html;
        pageContent.style.visibility = "visible";
    } else {
        pageStyle.onload = () => {
            pageContent.innerHTML = html;
            pageContent.style.visibility = "visible";
            pageStyle.onload = null;
        };

        pageStyle.href = newStyle;
    }

    document.querySelectorAll("a[data-page]").forEach(link => {
        link.classList.toggle("active_page", link.dataset.page === page);
    });

    window.scrollTo({
        top: 0,
        behavior: "auto"
    });
}


document.querySelectorAll("a[data-page]").forEach(link => {
    link.addEventListener("click", () => {
        const page = link.dataset.page;

        if (window.location.hash === `#${page}`) {
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        } else {
            loadPage(page);
        }

        const navigation = document.getElementById("main_navigation");

        if (navigation && navigation.classList.contains("show")) {
            bootstrap.Collapse.getOrCreateInstance(navigation).hide();
        }
    });
});


document.addEventListener("submit", async event => {
    const contactForm = event.target;

    if (!(contactForm instanceof HTMLFormElement) || contactForm.id !== "contact_form") {
        return;
    }

    event.preventDefault();

    const submitButton = contactForm.querySelector(".contact_submit_button");
    const statusText = contactForm.querySelector("#contact_form_status");
    const originalButtonText = submitButton.textContent;
    const formData = new FormData(contactForm);

    const payload = {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        phone: String(formData.get("phone") || "").trim(),
        message: String(formData.get("message") || "").trim(),
        website: String(formData.get("website") || "").trim()
    };

    statusText.textContent = "";
    statusText.classList.remove("contact_form_status_success", "contact_form_status_error");

    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    try {
        const response = await fetch("/api/contact", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.message || "We could not send your message. Please try again.");
        }

        contactForm.reset();

        statusText.textContent = "Thank you. Your message has been sent successfully.";
        statusText.classList.add("contact_form_status_success");
    } catch (error) {
        statusText.textContent = error.message || "We could not send your message. Please try again.";
        statusText.classList.add("contact_form_status_error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
});


window.addEventListener("popstate", () => {
    const page = window.location.hash.substring(1) || "home";
    loadPage(page);
});


const startingPage = window.location.hash.substring(1) || "home";
loadPage(startingPage);