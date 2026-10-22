"use strict";
// Runs in every top-level page of the browsing sessions (tabs and popups), in an isolated world the page cannot reach.
// NeuralWeb's own pages (neural://) get the `neural` bridge; web pages get nothing, but their login forms are
// watched so passwords can be offered for saving and filled from the password manager.
const { contextBridge, ipcRenderer } = require("electron");

// Registered for every frame of the session; only top frames get the bridge and the login watcher.
if (window !== window.top) {
  // sub-frame: nothing to do
} else if (location.protocol === "neural:") {
  contextBridge.exposeInMainWorld("neural", {
    call: (name, ...args) => ipcRenderer.invoke("page:call", String(name), ...args),
    on: (fn) => { ipcRenderer.on("page:event", (_e, payload) => fn(payload)); },
  });
} else if (location.protocol === "https:" || location.protocol === "http:") {
  watchLogins();
}

function watchLogins() {
  const TEXTY = new Set(["text", "email", "tel", ""]);
  const USERISH = /user|e-?mail|login|account|kullan|e-?posta|giri[sş]|identifier|phone|telefon/i;
  const SUBMITTY = /giri[sş]|oturum|login|log in|sign in|signin|devam|ileri|next|continue|submit|g[öo]nder|kaydol|[üu]ye ol|sign up|register/i;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const isPass = (el) => el instanceof HTMLInputElement && el.type === "password";
  const isText = (el) => el instanceof HTMLInputElement && TEXTY.has(el.type) && !el.readOnly && !el.disabled;
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const looksUser = (el) => isText(el) && (/username|email/.test(el.autocomplete || "") || el.type === "email" ||
    USERISH.test(`${el.name} ${el.id} ${el.getAttribute("aria-label") || ""} ${el.placeholder || ""}`));

  // The login boxes around an input: the password box of its form (or page) and the text box that goes with it.
  function fieldsAround(el) {
    const scope = el.form || document;
    const inputs = [...scope.querySelectorAll("input")].filter((i) => !i.disabled && shown(i));
    const pass = isPass(el) ? el : inputs.find(isPass) || null;
    let user = null;
    if (isText(el)) user = el;
    else if (pass) {
      const before = inputs.slice(0, inputs.indexOf(pass)).filter(isText).reverse();
      user = before.find(looksUser) || before[0] || null;
    }
    return { user, pass };
  }
  const isLogin = (el) => {
    if (!(isPass(el) || isText(el))) return false;
    const f = fieldsAround(el);
    return !!f.pass || looksUser(el);
  };

  let current = null;     // the login box the suggestions belong to
  let popupOpen = false;  // whether the main process shows saved accounts for it
  let filling = false;    // our own focus moves while filling must not reopen the suggestions
  function ask(el) {
    if (filling) return;
    current = el;
    const r = el.getBoundingClientRect();
    ipcRenderer.send("pw:focus", { x: r.left, y: r.top, width: r.width, height: r.height });
  }
  // Suggestions open on a click or keyboard focus, never by themselves when a page autofocuses a box.
  document.addEventListener("focusin", (e) => {
    if (isLogin(e.target) && navigator.userActivation.isActive) ask(e.target);
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (e.isTrusted && e.button === 0 && isLogin(e.target) && document.activeElement === e.target) ask(e.target);
  }, true);
  document.addEventListener("focusout", (e) => {
    if (e.target !== current) return;
    setTimeout(() => {
      // Focus that left the page (to the suggestions themselves, or another window) keeps them open.
      if (document.hasFocus() && document.activeElement !== current) { current = null; ipcRenderer.send("pw:blur"); }
    }, 0);
  }, true);
  document.addEventListener("input", (e) => { if (e.isTrusted && e.target === current && popupOpen) ipcRenderer.send("pw:blur"); }, true);
  document.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    if (popupOpen && e.target === current && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.send("pw:nav", e.key);
      return;
    }
    if (e.key === "Enter" && e.target instanceof HTMLInputElement && (isPass(e.target) || isText(e.target))) offer(e.target);
  }, true);
  ipcRenderer.on("pw:popup", (_e, open) => { popupOpen = !!open; });

  function setValue(el, v) {
    el.focus();
    valueSetter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  ipcRenderer.on("pw:fill", (_e, msg) => {
    if (!msg || msg.origin !== location.origin) return;
    const anchor = current && document.contains(current) ? current : document.activeElement;
    if (!(anchor instanceof HTMLInputElement)) return;
    const f = fieldsAround(anchor);
    filling = true;
    try {
      if (f.user && msg.username) setValue(f.user, msg.username);
      if (f.pass) setValue(f.pass, msg.password);
      (f.pass || f.user).focus();
    } finally {
      filling = false;
    }
  });

  // Offering to save: on submit, Enter, or a click on a sign-in looking button.
  let lastSent = "";
  function offer(anchor) {
    const f = fieldsAround(anchor);
    if (!f.pass || !f.pass.value) {
      // First page of a two-page sign-in: remember the user name for the password page.
      if (f.user && !f.pass && looksUser(f.user) && f.user.value.trim()) ipcRenderer.send("pw:userstep", f.user.value.trim());
      return;
    }
    const c = { username: f.user ? f.user.value.trim() : "", password: f.pass.value };
    const key = c.username + "\n" + c.password;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send("pw:submit", c);
  }
  document.addEventListener("submit", (e) => {
    const form = e.target;
    const anchor = form.querySelector && (form.querySelector("input[type=password]") || form.querySelector("input"));
    if (anchor) offer(anchor);
  }, true);
  document.addEventListener("click", (e) => {
    if (!e.isTrusted || !e.target.closest) return;
    const b = e.target.closest("button, input[type=submit], input[type=button], [role=button], a");
    if (!b) return;
    const label = `${b.textContent || ""} ${b.value || ""} ${b.getAttribute("aria-label") || ""}`;
    if (b.type !== "submit" && !SUBMITTY.test(label)) return;
    const scope = b.form || b.closest("form") || document;
    const anchor = scope.querySelector("input[type=password]") || (current && document.contains(current) ? current : scope.querySelector("input[type=email], input[autocomplete~=username]"));
    if (anchor) offer(anchor);
  }, true);
}
