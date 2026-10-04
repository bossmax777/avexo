/* Биржа на стенде работает круглосуточно.
   Страницы кабинета и хаба считают часы работы металлов по Нью-Йорку и на
   выходных показывают плашку «Биржа закрыта», глушат кнопки заявок и ставят
   сценарии на паузу. Для учебного показа это лишнее, поэтому здесь торговые
   отрезки заменяются на круглые сутки семь дней в неделю: от них считаются и
   признак «биржа открыта», и «сколько торгового времени прошло», так что ни
   плашки, ни замка в терминале, ни пауз в сценариях больше не возникает. */
(function () {
  "use strict";
  var GONE = "#mktStop,.mkt-stop,#mktBar,.mkt-bar,#termLock,.term-lock";
  var CSS = GONE + "{display:none!important}" +
    ".is-mkt-closed .ticket-go,.is-mkt-closed [data-side],.is-mkt-closed #btnStart" +
    "{opacity:1!important;pointer-events:auto!important;filter:none!important}";

  function css() {
    if (document.getElementById("mktOpenCss")) return;
    var s = document.createElement("style");
    s.id = "mktOpenCss";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* торговые отрезки суток — круглые сутки в любой день недели */
  try { window.mktSegs = function () { return [[0, 24]]; }; } catch (e) {}
  try { window.mktOpen = function () { return true; }; } catch (e) {}

  function clean() {
    css();
    var app = document.getElementById("app");
    if (app) app.classList.remove("is-mkt-closed");
    if (document.body) document.body.classList.remove("is-mkt-closed");
    var gone = document.querySelectorAll(GONE);
    for (var i = 0; i < gone.length; i++) gone[i].remove();
  }

  css();
  clean();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", clean);
  }
  setTimeout(clean, 400);
  setTimeout(clean, 1500);
})();
