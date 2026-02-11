(function(){
  const nav = [
    { href: "./index.html", label: "Teszt" },
    { href: "./learn.html", label: "Tanuló mód" },
    { href: "./admin.html", label: "Szerkesztő" },
  ];

  const headerHtml = `
    <div class="topbar">
      <div class="topbar__left">
        <a class="brand" href="./index.html">🧭 Barlangász</a>
        <nav class="nav">
          ${nav.map(x => `<a class="nav__link" href="${x.href}">${x.label}</a>`).join("")}
        </nav>
      </div>
      <div class="topbar__right">
        <button id="themeToggle" class="btn btn--sm btn--ghost" title="Téma váltás">🌙</button>
      </div>
    </div>
  `;

  const card = document.querySelector(".card");
  if (card){
    const wrap = document.createElement("div");
    wrap.innerHTML = headerHtml;
    card.insertBefore(wrap.firstElementChild, card.firstChild);
  } else {
    const wrap = document.createElement("div");
    wrap.innerHTML = headerHtml;
    document.body.insertBefore(wrap.firstElementChild, document.body.firstChild);
  }

  // highlight current page
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav__link").forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop();
    if (href === here) a.classList.add("is-active");
  });

  // theme logic
  const KEY = "theme";
  const root = document.documentElement;
  const btn = document.getElementById("themeToggle");

  function apply(theme){
    if (theme === "light"){
      root.setAttribute("data-theme", "light");
      if (btn) btn.textContent = "☀️";
    } else {
      root.removeAttribute("data-theme");
      if (btn) btn.textContent = "🌙";
    }
    localStorage.setItem(KEY, theme);
  }

  const saved = localStorage.getItem(KEY);
  if (saved) apply(saved);
  else {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    apply(prefersLight ? "light" : "dark");
  }

  if (btn){
    btn.addEventListener("click", () => {
      const isLight = root.getAttribute("data-theme") === "light";
      apply(isLight ? "dark" : "light");
    });
  }
})();