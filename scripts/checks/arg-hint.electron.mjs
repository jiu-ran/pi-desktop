import assert from "node:assert/strict";

/**
 * 命令参数提示（`/resume` 后面的 `<会话>`）的对齐回归。
 *
 * 以前的两处错位：
 * 1. 提示层挂在 .composer-field 上，`top: 9px / left: 10px`，和 textarea 的
 *    `padding: 13px 14px` 差 4px；字体也没跟上，textarea 落回浏览器等宽字体。
 * 2. 有附件（@ 引用 / 图片）时，附件条插在 textarea 上方，提示层还钉在顶上，
 *    结果画到附件上、和正文对不齐。
 */
export async function checkArgHintInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 往输入框里塞文字（走原生 setter + input 事件，让 v-model 生效）
  const setDraft = (text) =>
    evaluate(`(() => {
      const box = document.querySelector(".composer textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, ${JSON.stringify(text)});
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
      return true;
    })()`);

  // 命令菜单打开时不显示提示，按 Esc 关掉它（真实场景：打完命令发现不用选，先关菜单）
  const closeMenu = () =>
    evaluate(`(() => {
      const box = document.querySelector(".composer textarea");
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    })()`);

  const measure = () =>
    evaluate(`(() => {
      const box = document.querySelector(".composer textarea");
      const hint = document.querySelector(".arg-hint");
      const ghost = document.querySelector(".arg-ghost");
      if (!hint) return JSON.stringify({ hint: null });
      const style = getComputedStyle(box);
      const rect = box.getBoundingClientRect();
      // 用 textarea 自己的字体量一遍同样的文字，和图层里的透明副本比宽度
      const mirror = document.createElement("span");
      mirror.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      // 逐个属性抄（font 简写会把多字体回退链吃掉，量出来的宽度就不准）
      for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "letterSpacing", "wordSpacing", "textTransform"]) {
        mirror.style[key] = style[key];
      }
      mirror.textContent = ghost.textContent;
      document.body.appendChild(mirror);
      const mirrorWidth = mirror.getBoundingClientRect().width;
      mirror.remove();
      const hintRect = hint.getBoundingClientRect();
      // 提示层 = 透明副本（正文）+ 提示文字，取副本之后的那段
      const tail = hint.textContent.slice(ghost.textContent.length);
      return JSON.stringify({
        hint: tail,
        ghostWidth: Number(ghost.getBoundingClientRect().width.toFixed(2)),
        mirrorWidth: Number(mirrorWidth.toFixed(2)),
        dx: Number((hintRect.left - (rect.left + parseFloat(style.paddingLeft))).toFixed(2)),
        dy: Number((hintRect.top - (rect.top + parseFloat(style.paddingTop))).toFixed(2)),
        inside: hintRect.top >= rect.top - 1 && hintRect.bottom <= rect.bottom + 1,
        boxFont: style.font,
      });
    })()`);

  await evaluate(`window.__piDesktop.workbench.active.value ? true : true`);
  await wait(200);

  // 1. /compact + 空格，关掉命令菜单 → 提示 [压缩要求]
  await setDraft("/compact ");
  await wait(200);
  await closeMenu();
  await wait(250);
  const compact = JSON.parse(await measure());
  assert.ok(compact.hint, "输入 /compact 空格后应出现参数提示");
  assert.equal(compact.hint, "[压缩要求]", `参数提示内容不对：${JSON.stringify(compact.hint)}`);
  assert.ok(Math.abs(compact.dx) <= 1, `提示层左边应与 textarea 内容区对齐，实际差 ${compact.dx}px`);
  assert.ok(Math.abs(compact.dy) <= 1, `提示层顶边应与 textarea 内容区对齐，实际差 ${compact.dy}px`);
  assert.ok(
    Math.abs(compact.ghostWidth - compact.mirrorWidth) <= 1.5,
    `透明副本宽度应与输入框字体一致：副本 ${compact.ghostWidth}px，输入框字体 ${compact.mirrorWidth}px`,
  );

  // 2. /resume + 空格，同样对齐（有选项列表时菜单会盖住，先关掉）
  await setDraft("/resume ");
  await wait(200);
  await closeMenu();
  await wait(250);
  const resume = JSON.parse(await measure());
  assert.ok(resume.hint, "输入 /resume 空格后应出现参数提示");
  assert.equal(resume.hint, "<会话>", `参数提示内容不对：${JSON.stringify(resume.hint)}`);
  assert.ok(Math.abs(resume.dx) <= 1 && Math.abs(resume.dy) <= 1, "带选项的命令同样要对齐");
  const noSpace = compact;
  const withSpace = resume;

  // 3. 提示层必须挂在「只包输入框」的容器上：挂在 .composer-field 上会被上方的附件条顶偏
  const host = JSON.parse(
    await evaluate(`(() => {
      const hint = document.querySelector(".arg-hint");
      const box = document.querySelector(".composer textarea");
      const holder = hint.parentElement;
      const strip = document.querySelector(".attachment-strip");
      return JSON.stringify({
        holder: holder.className,
        holderIsField: holder.classList.contains("composer-field"),
        sameParentAsTextarea: holder.contains(box),
        stripOutside: !strip || !holder.contains(strip),
      });
    })()`),
  );
  assert.ok(host.sameParentAsTextarea, "提示层应与输入框共用同一个父节点");
  assert.ok(!host.holderIsField, `提示层不该直接挂在 .composer-field 上（会被附件条顶偏），实际 ${host.holder}`);
  assert.ok(host.stripOutside, "附件条应在提示层容器之外，不能和提示层抢同一个定位基准");

  // 4. 真把附件条插进去：输入框整体下移，提示必须跟着走，不能留在顶上盖住附件
  const shifted = JSON.parse(
    await evaluate(`(() => {
      const field = document.querySelector(".composer-field");
      const probe = document.createElement("div");
      probe.className = "attachment-strip";
      probe.id = "arg-hint-probe-strip";
      probe.innerHTML = '<span class="attachment-chip">引用的对话</span>';
      field.insertBefore(probe, document.querySelector(".composer-input"));
      return new Promise((resolve) => setTimeout(() => {
        const box = document.querySelector(".composer textarea");
        const hint = document.querySelector(".arg-hint");
        const style = getComputedStyle(box);
        const rect = box.getBoundingClientRect();
        const hintRect = hint.getBoundingClientRect();
        probe.remove();
        resolve(JSON.stringify({
          dy: Number((hintRect.top - (rect.top + parseFloat(style.paddingTop))).toFixed(2)),
          inside: hintRect.top >= rect.top - 1 && hintRect.bottom <= rect.bottom + 1,
        }));
      }, 120));
    })()`),
  );
  assert.ok(Math.abs(shifted.dy) <= 1, `有附件条时提示仍要贴着正文，实际差 ${shifted.dy}px`);
  assert.ok(shifted.inside, "有附件条时提示不能跑到输入框外面（以前会盖在附件上）");

  // 5. / 菜单只列真能执行的命令：
  //    - 桌面端补上的（/trust /import /changelog /quit）必须出现；
  //    - 只能在终端里做的（/tree /login /share…）不该出现在候选里，
  //      但直接敲出来时必须给出说明，不能当普通文字发给模型。
  await setDraft("/");
  await wait(300);
  const menuNames = JSON.parse(
    await evaluate(`(() => {
      const items = [...document.querySelectorAll(".slash-menu .slash-item")].map(
        (el) => (el.querySelector(".slash-name")?.textContent ?? "").replace("/", ""),
      );
      return JSON.stringify(items);
    })()`),
  );
  for (const name of ["trust", "import", "changelog", "quit"]) {
    assert.ok(menuNames.includes(name), `/ 菜单里缺少 /${name}（Pi 有这条命令，桌面端要适配）`);
  }
  const terminalOnly = ["tree", "scoped-models", "share", "bug", "login", "logout"];
  for (const name of terminalOnly) {
    assert.ok(!menuNames.includes(name), `/${name} 桌面端做不了，不该出现在菜单里`);
  }

  // 直接敲 /login：菜单显示解释，回车也不能发出去（不能变成给模型的一句 "/login"）
  await setDraft("/login");
  await wait(300);
  const loginMenu = await evaluate(`document.querySelector(".slash-menu .slash-empty")?.textContent ?? ""`);
  assert.ok(loginMenu.includes("只能在终端里用"), `敲 /login 时菜单要解释原因，实际 ${JSON.stringify(loginMenu)}`);
  const before = await evaluate(`document.querySelectorAll(".msg.user").length`);
  await evaluate(`(() => {
    const box = document.querySelector(".composer textarea");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  })()`);
  await wait(600);
  const after = await evaluate(`document.querySelectorAll(".msg.user").length`);
  const toast = await evaluate(`[...document.querySelectorAll(".toast")].map((el) => el.textContent).join(" | ")`);
  assert.equal(after, before, "在终端专属命令上回车不能真的发出一条消息");
  assert.ok(toast.includes("只能在终端里用"), `回车后要给提示，实际 ${JSON.stringify(toast)}`);
  const cleared = await evaluate(`document.querySelector(".composer textarea").value`);
  assert.equal(cleared, "", "拦下之后输入框应清空（这条不是要发给模型的话）");

  await closeMenu();
  await wait(150);
  await setDraft("");

  console.log(
    "[arg-hint]",
    JSON.stringify({ compact, resume: { dx: resume.dx, dy: resume.dy, hint: resume.hint }, shifted, host: host.holder }),
  );
  console.log("[arg-hint] / 菜单", JSON.stringify({ 命令数: menuNames.length, 终端专属已隐藏: terminalOnly.length }));
  return { compact, resume, shifted };
}
