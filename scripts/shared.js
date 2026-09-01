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

    if (pageStyle.getAttribute("href") === newStyle) {
        pageContent.innerHTML = html;
    } else {
        pageContent.style.visibility = "hidden";

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

window.addEventListener("popstate", () => {
    const page = window.location.hash.substring(1) || "home";
    loadPage(page);
});

const startingPage = window.location.hash.substring(1) || "home";
loadPage(startingPage);