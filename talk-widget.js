(function () {
  if (document.querySelector(".talk-widget")) return;

  const kakaoTalkUrl = "https://open.kakao.com/o/syAk2oti";
  const widget = document.createElement("div");
  widget.className = "talk-widget";
  widget.innerHTML = `
    <div class="talk-panel" id="talkPanel" aria-hidden="true">
      <div class="talk-panel-head">
        <div>
          <h2>ELIN 톡 주문</h2>
          <p>주문, 입금, 배송, 상품 문의를 남겨주세요.</p>
        </div>
        <button class="talk-close" type="button" aria-label="톡 주문 닫기">×</button>
      </div>
      <div class="talk-actions">
        <a class="talk-action kakao" href="${kakaoTalkUrl}" target="_blank" rel="noopener">카카오톡으로 주문하기 <span>›</span></a>
        <a class="talk-action" href="/customer.html">1:1 문의 남기기 <span>›</span></a>
      </div>
      <div class="talk-time">상담시간 오전 10시 ~ 오후 8시 (연중무휴)</div>
    </div>
    <button class="talk-toggle" type="button" aria-expanded="false" aria-controls="talkPanel">
      <span class="talk-toggle-icon">TALK</span>
      <span>톡 주문</span>
    </button>
  `;

  document.body.appendChild(widget);

  const toggle = widget.querySelector(".talk-toggle");
  const close = widget.querySelector(".talk-close");
  const panel = widget.querySelector(".talk-panel");

  function setOpen(open) {
    widget.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
  }

  toggle.addEventListener("click", () => setOpen(!widget.classList.contains("open")));
  close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setOpen(false);
  });
  document.addEventListener("click", event => {
    if (!widget.contains(event.target)) setOpen(false);
  });
})();
