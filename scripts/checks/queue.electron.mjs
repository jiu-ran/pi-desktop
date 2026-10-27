import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 排队展示回归（纯渲染侧，不请求模型）：
 * - 排队中的消息只在对话里出现一次（气泡带「待发送」），输入框上方不再重复列出
 * - 队列里对不上气泡的条目才显示成待发送卡片（带模式标签与截断预览）
 * - 队列清空后气泡上的「待发送」消失
 */
export async function checkQueueInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 6000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(100);
    }
    throw new Error(`排队展示检查超时：${label}`);
  };

  // 真存在的一个附件：类型徽标与大小都是按磁盘上的文件算的
  const attachDir = await mkdtemp(path.join(tmpdir(), "pi-queue-attach-"));
  const attachFile = path.join(attachDir, "note.txt");
  await writeFile(attachFile, "x".repeat(2048));

  const ids = JSON.parse(await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    // 注意：路径原样拼进去，不要再转义反斜杠 —— 否则按这个路径去查文件大小会找不到
    const attach = ${JSON.stringify(attachFile)};
    const prompt = '<file name="' + attach + '">' + String.fromCharCode(10) + '内容' + String.fromCharCode(10) + '</file>' + String.fromCharCode(10) + '顺便看下日志';
    thread.transcript.removeBlock("queue-a");
    thread.transcript.removeBlock("queue-b");
    const a = thread.transcript.pushUser("顺便看下日志", 0, { queueText: prompt });
    a.id = "queue-a";
    const b = thread.transcript.pushUser("这条没有气泡对应", 0, { queueText: "另一条完整提示词" });
    b.id = "queue-b";
    // 只把 a 的那条放进队列：b 用另一个文本，模拟「别人的队列项」
    thread.queue = { steering: [], followUp: [prompt, "只存在于队列里的消息"] };
    return JSON.stringify({ a: a.id, b: b.id });
  })()`));

  await poll("document.querySelectorAll('.queue-card').length === 2", "两条排队消息都应列在输入框上方");
  // 附件大小要过一趟 IPC，等它回填后再读快照
  await poll("Boolean(document.querySelector('.queue-file-name'))", "附件文件名出现");

  const view = JSON.parse(await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.queue-card')];
    return JSON.stringify({
      // 队列里那条已经乐观渲染成气泡：上方既然列出来了，对话里就不能再显示
      hiddenBubble: Boolean(document.querySelector('[data-block-id="queue-a"]')),
      visibleBubbles: document.querySelectorAll('.msg-user-bubble').length,
      badges: cards.map((n) => n.querySelector('.queue-card-badge')?.textContent.trim() ?? ''),
      // 「待发送」只在表头报一次；卡片上不再重复
      cardRoles: cards.map((n) => ({
        role: n.getAttribute('role') ?? '',
        tabindex: n.getAttribute('tabindex') ?? '',
        label: n.getAttribute('aria-label') ?? '',
        grip: Boolean(n.querySelector('.queue-card-grip')),
        // 把手平时隐起来，悬停才现形
        gripOpacity: n.querySelector('.queue-card-grip') ? getComputedStyle(n.querySelector('.queue-card-grip')).opacity : null,
        gripTitle: n.querySelector('.queue-card-grip')?.getAttribute('title') ?? '',
      })),
      listRole: document.querySelector('.queue-list')?.getAttribute('role') ?? '',
      listScrollable: (() => {
        const list = document.querySelector('.queue-list');
        if (!list) return null;
        return { maxHeight: getComputedStyle(list).maxHeight, overflowY: getComputedStyle(list).overflowY };
      })(),
      headHint: document.querySelector('.queue-head-hint')?.textContent.trim() ?? '',
      icons: cards.map((n) => ({
        count: n.querySelectorAll('.queue-card-icon').length,
        actionsOpacity: n.querySelector('.queue-card-actions') ? getComputedStyle(n.querySelector('.queue-card-actions')).opacity : null,
        edit: Boolean(n.querySelector('.queue-card-icon:not(.is-withdraw)')),
        withdraw: n.querySelector('.queue-card-icon.is-withdraw')?.getAttribute('title') ?? '',
      })),
      cards: cards.map((n) => ({
        tag: n.querySelector('.queue-card-mode .select-menu-value')?.textContent.trim() ?? '',
        text: n.querySelector('.queue-card-text')?.textContent.trim() ?? '',
        // 投递方式与正文同一行：正文跟在胶囊后面，不再独占一行
        textLeft: Math.round(n.querySelector('.queue-card-text')?.getBoundingClientRect().left ?? 0),
        pillLeft: Math.round(n.querySelector('.queue-card-mode')?.getBoundingClientRect().left ?? 0),
        textOnPillLine: (() => {
          const text = n.querySelector('.queue-card-text')?.getBoundingClientRect();
          const pill = n.querySelector('.queue-card-mode')?.getBoundingClientRect();
          if (!text || !pill) return false;
          const sameRow = Math.abs(text.top + text.height / 2 - (pill.top + pill.height / 2)) <= 6;
          return sameRow && text.left >= pill.right - 2;
        })(),
        // 正文单行截断：高度应该只有一行
        textLines: (() => {
          const text = n.querySelector('.queue-card-text');
          if (!text) return 0;
          const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 1;
          return Math.round(text.getBoundingClientRect().height / lineHeight);
        })(),
        cardTitle: n.getAttribute('title') ?? '',
        // 附件是独立一行：类型徽标 + 文件名 + 大小
        files: [...n.querySelectorAll('.queue-file-name')].map((file) => ({
          name: file.textContent.trim(),
          title: file.getAttribute('title') ?? '',
          aboveText: (() => {
            const box = file.getBoundingClientRect();
            const text = n.querySelector('.queue-card-text')?.getBoundingClientRect();
            return Boolean(text && box.bottom <= text.top + 2);
          })(),
        })),
        pillBox: (() => {
          const r = n.querySelector('.queue-card-mode .select-menu-trigger')?.getBoundingClientRect();
          return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
        })(),
      })),
      label: document.querySelector('.queue-label')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
      recall: Boolean(document.querySelector('.queue-recall')),
      // 附件 XML 绝不能出现在卡片上
      leaksMarkers: (document.querySelector('.queue-strip')?.textContent ?? '').includes('<file'),
    });
  })()`));

  assert.equal(view.hiddenBubble, false, "还排在队列里的消息不应同时出现在对话里");
  assert.equal(view.visibleBubbles, 1, `队列里没有对应气泡的那条照常显示，实际 ${view.visibleBubbles}`);
  assert.equal(view.cards.length, 2, `队列里的两条都应列在输入框上方，实际 ${view.cards.length}`);
  assert.deepEqual(view.badges, ["", ""], "「待发送」只在表头报一次，卡片上不重复");
  assert.equal(view.listRole, "list", "待发送区应是列表语义");
  assert.equal(view.headHint, "", "表头不再堆提示文字（提示放进把手的 title）");
  assert.ok(
    view.cardRoles.every((role) => role.gripTitle.includes("Alt")),
    `键盘排序的提示要在把手 title 里：${JSON.stringify(view.cardRoles.map((role) => role.gripTitle))}`,
  );
  assert.deepEqual(view.listScrollable?.overflowY, "auto", "排很多条时只滚卡片区（不顶输入框）");
  assert.equal(
    await evaluate("document.querySelectorAll('.queue-card-edit, .queue-card-withdraw').length"),
    0,
    "旧版的文本按钮（编辑 / 撤回）不该再存在，现在是图标",
  );
  for (const [index, role] of view.cardRoles.entries()) {
    assert.equal(role.role, "listitem", `第 ${index + 1} 条应是 listitem`);
    assert.equal(role.tabindex, "0", `第 ${index + 1} 条要能聚焦（Alt+↑/↓ 排序的前提）`);
    assert.match(role.label, new RegExp(`第 ${index + 1} 条`), `读屏文案要带序号：${role.label}`);
    assert.equal(role.grip, true, "每条都要有拖拽把手");
    assert.equal(role.gripOpacity, "0", "把手平时隐起来，别当成一列杂点");
    assert.equal(view.cards[index].cardTitle, "", "整张卡片不再挂长 title（它会遮蔽按钮的 tooltip）");
  }
  assert.equal(view.cards[0].tag, "排队", "卡片要标出投递方式（排队）");
  assert.ok(
    view.cards.some((card) => card.text === "只存在于队列里的消息"),
    `队列里那条没有气泡的消息应显示在卡片上：${view.cards.map((c) => c.text).join(" | ")}`,
  );
  // 方案 A 的排版：附件一行（徽标 + 文件名 + 大小），正文与投递方式同一行、单行截断
  for (const card of view.cards) {
    assert.ok(card.pillBox, "每条卡片都要有一个投递方式下拉");
    // `.select-menu.is-sm .select-menu-trigger` 是 0,3,0：拿不到 18px 高说明特异性又被打回去了
    assert.ok(card.pillBox.h <= 20, `投递方式应该是小号胶囊，实测 ${card.pillBox.h}px 高`);
    assert.ok(card.pillBox.w <= 64, `投递方式不该撑成大按钮，实测 ${card.pillBox.w}px 宽`);
    assert.equal(card.textOnPillLine, true, "正文要和投递方式排在同一行（方案 A）");
    assert.equal(card.textLines <= 1, true, `正文只能占一行，实际 ${card.textLines} 行`);
    assert.equal(card.cardTitle, "", "整张卡片不再挂长 title（它会遮蔽按钮的 tooltip）");
  }
  // 图标操作：默认隐起来，悬停才现；两个都要有可读名称
  assert.deepEqual(
    view.icons.map((item) => item.count),
    [2, 2],
    `每张卡片要有编辑 / 撤回两个图标按钮：${JSON.stringify(view.icons)}`,
  );
  assert.ok(
    view.icons.every((item) => item.actionsOpacity === "0"),
    `图标操作默认要隐起来（悬停才现），实际 ${view.icons.map((item) => item.actionsOpacity).join(",")}`,
  );
  assert.ok(view.icons.every((item) => item.edit), "要有编辑按钮");
  assert.ok(view.icons.every((item) => item.withdraw.includes("撤回")), "撤回按钮要有可读名称");

  assert.equal(view.leaksMarkers, false, "卡片上不能出现附件 XML");
  // 附件行：只有文件名（不画图标、不算大小），且排在正文上面
  const withFile = view.cards.find((card) => card.files.length);
  assert.ok(withFile, `带附件的排队消息应该列出附件行：${JSON.stringify(view.cards)}`);
  assert.deepEqual(
    withFile.files.map((file) => file.name),
    ["note.txt"],
    `附件行要写文件名，实际 ${JSON.stringify(withFile.files)}`,
  );
  assert.match(withFile.files[0].title, /note\.txt$/, "附件要有完整路径的 title");
  assert.equal(withFile.files[0].aboveText, true, "附件行要在正文上面");
  // 用户明确不要的东西：类型图标不要，大小也不要
  assert.equal(
    await evaluate("document.querySelectorAll('.queue-file-badge, .queue-file-size, .queue-file svg').length"),
    0,
    "附件行不该再有类型图标或文件大小",
  );
  assert.equal(withFile.text, "顺便看下日志", `附件不能把正文弄脏，实际「${withFile.text}」`);
  assert.equal(
    view.cards.some((card) => card.text.includes("[文件") || card.text.includes("[目录")),
    false,
    `正文不该再出现 [文件: …] 这类标签：${view.cards.map((card) => card.text).join(" | ")}`,
  );
  assert.match(view.label, /2 条待发送/, `标题应显示条数，实际「${view.label}」`);
  assert.ok(view.recall, "全部撤回要保留");

  // 截图留档：人工确认排版（调试协议截图，避免拿到旧帧）
  const shot = async (name) => {
    try {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) await dbg.attach("1.3");
      const result = await Promise.race([
        dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!result?.data) return `${name}（跳过）`;
      const { writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const { tmpdir } = await import("node:os");
      await writeFile(path.join(tmpdir(), name), Buffer.from(result.data, "base64"));
      return name;
    } catch (error) {
      return `${name}（失败：${error?.message ?? error}）`;
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }
  };
  console.log("[queue] shot", await shot("queue-dark.png"));
  await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
  await wait(400);
  console.log("[queue] shot", await shot("queue-light.png"));
  await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
  await wait(200);

  // ---- 排队卡片：投递方式是下拉（引导 / 排队），整张卡片可拖拽排序 ----
  // 重新入队的语义（顺序 / 图片 / 失败还原）由内核级 queue-mode.check.ts 覆盖，
  // 这里只验证界面链路：控件在不在、能不能拖、拖完传出去的顺序对不对。
  {
    // 注意：这里不要用多行模板串拼表达式 —— executeJavaScript 的返回值必须是可结构化克隆的，
    // 之前写成多行箭头函数时偶发 "An object could not be cloned"，改用单行表达式最稳。
    const rawCards = await evaluate(
      'JSON.stringify([...document.querySelectorAll(".queue-card")].map((node) => ({' +
        'mode: (node.querySelector(".queue-card-mode .select-menu-value")?.textContent || "").trim(),' +
        'modeKind: node.querySelector(".queue-card-mode .select-menu-trigger")?.tagName || "",' +
        'modeLabel: node.querySelector(".queue-card-mode .select-menu-trigger")?.getAttribute("aria-label") || "",' +
        'draggable: node.getAttribute("draggable"),' +
        'grip: Boolean(node.querySelector(".queue-card-grip")),' +
        'text: (node.querySelector(".queue-card-text")?.textContent || "").trim(),' +
        'withdraw: (node.querySelector(".queue-card-icon.is-withdraw")?.getAttribute("title") || "").includes("撤回") ? "撤回" : "",' +
      '})))',
    );
    const cards = JSON.parse(rawCards);
    assert.equal(cards.length, 2, `队列里的两条都应列出来，实际 ${cards.length}`);
    assert.deepEqual(cards.map((item) => item.mode), ["排队", "排队"], `卡片要写出当前投递方式：${JSON.stringify(cards)}`);
    assert.ok(cards.every((item) => item.modeKind === "BUTTON"), "投递方式要能点（按钮）");
    assert.ok(cards.every((item) => item.modeLabel.length > 0), "投递方式按钮要有可读的无障碍名称");
    assert.ok(cards.every((item) => item.draggable === "true"), "卡片要可拖拽（拖拽排序）");
    assert.ok(cards.every((item) => item.grip), "卡片要显示拖拽把手（点阵用 CSS 画，不是内联 svg）");
    assert.deepEqual(cards.map((item) => item.withdraw), ["撤回", "撤回"], "每条都要有撤回图标（title 里写清）");

    // 方案 A 没有分组说明：投递方式胶囊已经说明怎么发
    const notes = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('.queue-group-note')].map((n) => n.textContent.trim()))"));
    assert.deepEqual(notes, [], `方案 A 里不再有分组说明行，实际 ${JSON.stringify(notes)}`);
  }

  // ---- 投递方式下拉：两个选项，选中项带勾 ----
  {
    const menu = JSON.parse(await evaluate(`(async () => {
      const trigger = document.querySelector('.queue-card-mode .select-menu-trigger');
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 160));
      const popup = document.querySelector('.select-menu-popup');
      return JSON.stringify({
        open: Boolean(popup),
        parent: popup?.parentElement?.tagName ?? '',
        items: [...(popup?.querySelectorAll('.select-menu-item') ?? [])].map((node) => ({
          label: node.querySelector('.select-menu-item-label')?.textContent.trim() ?? '',
          hint: node.querySelector('.select-menu-item-hint')?.textContent.trim() ?? '',
          active: node.classList.contains('active'),
        })),
      });
    })()`));
    assert.equal(menu.open, true, "点投递方式要弹出下拉");
    assert.deepEqual(menu.items.map((item) => item.label), ["引导", "排队"], `下拉只有这两种投递方式：${JSON.stringify(menu.items)}`);
    assert.ok(menu.items[1].hint.includes("本轮结束"), "排队要说明是等本轮结束");
    assert.equal(menu.items.filter((item) => item.active).length, 1, "只能有一项是当前值");
    // 关掉，不影响后面的拖拽
    await evaluate("document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); true");
    await wait(160);
  }

  // ---- 拖拽排序：把第二条拖到第一条前面 ----
  {
    // 真实拖拽会走 clearQueue + 重新入队（可能真的开始一轮对话），这里换成记录函数，
    // 只验证界面把「拖出来的顺序」原样交给内核。
    await evaluate(`(() => {
      window.__reorderCalls = [];
      window.__piDesktop.workbench.reorderQueued = async (order) => {
        window.__reorderCalls.push(order);
        return true;
      };
      return true;
    })()`);
    // Vue 的 class 更新是异步的：每一步之间要让出一帧再断言
    await evaluate("(() => { const cards = [...document.querySelectorAll('.queue-card')]; window.__dragData = new DataTransfer(); cards[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragData })); return true; })()");
    await wait(160);
    assert.equal(await evaluate("document.querySelectorAll('.queue-card.dragging').length"), 1, "拖拽开始时卡片要进入拖拽态");

    await evaluate("(() => { const first = document.querySelector('.queue-card'); const rect = first.getBoundingClientRect(); first.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: window.__dragData, clientY: Math.round(rect.top + 2) })); return true; })()");
    await wait(160);
    assert.equal(await evaluate("document.querySelectorAll('.queue-card.drop-before').length"), 1, "拖到卡片上半部分要画出插入线（在它前面）");

    await evaluate("(() => { const first = document.querySelector('.queue-card'); const rect = first.getBoundingClientRect(); first.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.__dragData, clientY: Math.round(rect.top + 2) })); return true; })()");
    await wait(320);
    const ordered = JSON.parse(await evaluate("JSON.stringify(window.__reorderCalls)"));
    assert.equal(ordered.length, 1, "拖放应触发一次重排");
    assert.equal(ordered[0].length, 2, "重排要带上整个待发送队列");
    assert.equal(ordered[0][0].text, "只存在于队列里的消息", "被拖的那条要排到最前");
    assert.equal(ordered[0][1].text.includes("顺便看下日志"), true, "另一条排到后面");
    assert.ok(ordered[0].every((entry) => entry.mode === "followUp"), "同组内拖动不改投递方式");
    assert.equal(await evaluate("document.querySelectorAll('.queue-card.dragging').length"), 0, "松手后不能再有拖拽态的卡片");
    assert.equal(await evaluate("document.querySelectorAll('.queue-card.drop-before, .queue-card.drop-after').length"), 0, "插入线要收掉");
    assert.equal(await evaluate("document.querySelectorAll('.queue-card.drop-before, .queue-card.drop-after').length"), 0, "插入线要收掉");
  }

  // ---- 混合队列：两组各有一句说明；跨组拖拽 = 顺带改投递方式 ----
  {
    // 这一节会改队列，结束时要还原，后面的编辑 / 撤回测试还依赖原来那两条
    const previousQueue = JSON.parse(
      await evaluate("JSON.stringify(window.__piDesktop.workbench.active.value.activeThread.queue)"),
    );
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.queue = { steering: ["插一句"], followUp: ["排队一", "排队二"] };
      return true;
    })()`);
    await wait(260);
    const notes = JSON.parse(
      await evaluate("JSON.stringify([...document.querySelectorAll('.queue-group-note')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()))"),
    );
    assert.deepEqual(notes, [], `方案 A 里不再有分组说明行，实际 ${JSON.stringify(notes)}`);

    const modes = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('.queue-card')].map((n) => n.querySelector('.queue-card-mode .select-menu-value')?.textContent.trim()))"));
    assert.deepEqual(modes, ["引导", "排队", "排队"], `卡片要各自标出投递方式：${JSON.stringify(modes)}`);

    // 把最后一条（排队）拖到第一条（引导）前面：投递方式要跟着落点变成引导
    await evaluate(`(() => {
      window.__reorderCalls = [];
      window.__piDesktop.workbench.reorderQueued = async (order) => { window.__reorderCalls.push(order); return true; };
      const cards = [...document.querySelectorAll('.queue-card')];
      window.__dragData = new DataTransfer();
      cards[2].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragData }));
      const rect = cards[0].getBoundingClientRect();
      cards[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: window.__dragData, clientY: Math.round(rect.top + 2) }));
      cards[0].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.__dragData, clientY: Math.round(rect.top + 2) }));
      return true;
    })()`);
    await wait(320);
    const cross = JSON.parse(await evaluate("JSON.stringify(window.__reorderCalls)"));
    assert.equal(cross.length, 1, "跨组拖拽也要触发一次重排");
    assert.equal(cross[0][0].text, "排队二", `被拖的那条排到最前：${JSON.stringify(cross[0])}`);
    assert.equal(cross[0][0].mode, "steer", "落到引导组前面就变成引导（立刻插入当前回合）");
    assert.deepEqual(
      cross[0].map((entry) => `${entry.mode}:${entry.text}`),
      ["steer:排队二", "steer:插一句", "followUp:排队一"],
      "扁平顺序里引导在前、排队在后",
    );

    await evaluate(`(() => {
      window.__piDesktop.workbench.active.value.activeThread.queue = ${JSON.stringify(previousQueue)};
      return true;
    })()`);
    await wait(260);
  }

  // ---- 编辑排队消息 ----
  // 真实编辑会调用 clearQueue / steer / followUp（可能真的开始一轮对话），
  // 这里只验证界面链路：把 editQueued 换成记录函数，断言参数正确。
  await evaluate(`(() => {
    window.__queueEditCalls = [];
    const workbench = window.__piDesktop.workbench;
    window.__queueEditOriginal = workbench.editQueued;
    workbench.editQueued = async (target, next) => {
      window.__queueEditCalls.push({ target, next });
      return true;
    };
    return true;
  })()`);

  // 1) 卡片上的文字就是编辑入口（第一条是气泡对应的那条）
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "点击卡片应展开编辑框");
  {
    const editor = JSON.parse(await evaluate(`(() => {
      const area = document.querySelector('.queue-editor textarea');
      return JSON.stringify({
        value: area.value,
        rows: area.rows,
        actions: [...document.querySelectorAll('.queue-editor-actions button')].map((n) => n.textContent.trim()),
        hint: document.querySelector('.queue-editor-hint')?.textContent.trim() ?? '',
      });
    })()`));
    assert.equal(editor.value, "只存在于队列里的消息", `编辑框应预填这条消息的实际内容，实际「${editor.value}」`);
    assert.ok(editor.actions.includes("保存并重新排队"), "要有保存按钮");
    assert.ok(editor.actions.includes("取消"), "要有取消按钮");
    assert.match(editor.hint, /排队/, "编辑框要标出模式");
    assert.match(editor.hint, /Ctrl\+V/, "编辑框要提示可以粘贴图片");
  }

  // 1.5) 带图片附件的排队消息：编辑框里绝不能预填 [文件: …] 标签（否则保存后多一份路径）
  // 先关掉上一个编辑框，等卡片重新渲染出来再点（v-else 分支要下一个 tick 才挂上）
  await evaluate(`(() => {
    [...document.querySelectorAll('.queue-editor-actions button')]
      .find((n) => n.textContent.includes('取消'))?.click();
    return true;
  })()`);
  await wait(250);
  const openedAttached = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('顺便看下日志'));
    if (!card) return false;
    card.querySelector('.queue-card-icon:not(.is-withdraw)')?.click();
    return true;
  })()`);
  assert.ok(openedAttached, "带附件的排队卡片上应有编辑图标");
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "打开带附件的排队消息");
  {
    const attached = JSON.parse(await evaluate(`(() => {
      const area = document.querySelector('.queue-editor textarea');
      return JSON.stringify({
        value: area.value,
        chips: [...document.querySelectorAll('.queue-attach-chip')].map((n) => ({
          name: n.querySelector('.queue-attach-name')?.textContent.trim() ?? '',
          added: n.classList.contains('added'),
        })),
      });
    })()`));
    assert.equal(attached.value, "顺便看下日志", `带附件的消息只预填用户文字，实际「${attached.value}」`);
    assert.equal(
      attached.value.includes("[文件"),
      false,
      `编辑框里不能出现展示用的附件标签，实际「${attached.value}」`,
    );
    assert.deepEqual(attached.chips.map((chip) => chip.name), ["note.txt"], `附件要单独列出来：${JSON.stringify(attached.chips)}`);
    assert.equal(attached.chips[0].added, false, "原有附件不是「新粘贴」状态");

    // 截图留档：编辑框里的附件标签 + 提示（人工核对排版）
    try {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) await dbg.attach("1.3");
      const box = JSON.parse(await evaluate(`(() => {
        const strip = document.querySelector('.queue-strip-editing');
        const r = strip.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left) - 8, y: Math.round(r.top) - 8, width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 });
      })()`));
      const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
      const { writeFile } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const { tmpdir } = await import("node:os");
      await writeFile(nodePath.join(tmpdir(), "queue-attach-editor.png"), Buffer.from(shot.data, "base64"));
      console.log("[queue] shot queue-attach-editor.png");
    } catch (error) {
      console.log("[queue] shot queue-attach-editor.png（跳过）", error?.message ?? error);
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }
  }

  // 1.6) Ctrl+V 粘贴图片：先落盘（这里换成假实现），保存时带上新路径
  await evaluate(`(() => {
    window.__queuePasteCalls = [];
    const workbench = window.__piDesktop.workbench;
    window.__stageOriginal = workbench.stagePastedAttachment;
    workbench.stagePastedAttachment = async (payload) => {
      window.__queuePasteCalls.push({ name: payload?.name, mimeType: payload?.mimeType, bytes: String(payload?.data ?? '').length });
      return { path: 'C:\\\\Temp\\\\pi-desktop-paste\\\\pasted-1.png', name: 'pasted-1.png' };
    };
    // 造一个带 png 文件的 paste 事件（Chromium 支持构造 File / DataTransfer）
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'clip.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    const area = document.querySelector('.queue-editor textarea');
    area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await poll("document.querySelectorAll('.queue-attach-chip.added').length === 1", "粘贴后应出现新附件标签");
  {
    const pasted = JSON.parse(await evaluate(`(() => {
      const area = document.querySelector('.queue-editor textarea');
      area.value = "顺便看下日志，再对比这张图";
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({
        chips: [...document.querySelectorAll('.queue-attach-chip')].map((n) => n.querySelector('.queue-attach-name')?.textContent.trim() ?? ''),
        text: area.value,
        pasteCalls: window.__queuePasteCalls,
      });
    })()`));
    assert.deepEqual(pasted.pasteCalls.length, 1, "粘贴应调用一次落盘接口");
    assert.equal(pasted.pasteCalls[0].mimeType, "image/png", "要带上图片类型");
    assert.ok(pasted.pasteCalls[0].bytes > 20, "要带上图片数据（dataURL）");
    assert.deepEqual(pasted.chips, ["note.txt", "pasted-1.png"], `原有 + 新粘贴的附件都要列出：${JSON.stringify(pasted.chips)}`);
  }

  // 1.7) 保存 → editQueued 收到「原提示词 + 新文字 + 新附件路径」，且文字里没有附件标记
  await evaluate(`(() => {
    [...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes('保存'))?.click();
    return true;
  })()`);
  await poll("!document.querySelector('.queue-editor')", "保存后编辑框应关闭");
  {
    const calls = JSON.parse(await evaluate("JSON.stringify(window.__queueEditCalls)"));
    const last = calls.at(-1);
    // 期望值直接取页面里注入的那条提示词：路径里的反斜杠不必在断言里再转义一遍
    const expectedPrompt = await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      return thread.transcript.blocks.find((block) => block.id === "queue-a")?.queueText ?? "";
    })()`);
    assert.ok(expectedPrompt.includes("<file name="), `注入的提示词应带附件块：${expectedPrompt}`);
    assert.equal(last.target.text, expectedPrompt, "要带上原来的完整提示词");
    assert.equal(last.next.message, "顺便看下日志，再对比这张图", "保存的是新文字");
    // 路径里的反斜杠在断言里再转义容易出错，这里只看个数与文件名
    assert.equal(last.next.addPaths.length, 1, `新粘贴的附件要带给内核：${JSON.stringify(last.next.addPaths)}`);
    assert.ok(last.next.addPaths[0].endsWith("pasted-1.png"), `附件路径要指向刚粘贴的图片：${last.next.addPaths[0]}`);
    assert.equal(
      String(last.next.message).includes("[文件"),
      false,
      "新文字里不能混进附件标签",
    );
  }

  // 2) 保存 → editQueued 收到「原来的完整提示词 + 新文字」
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "再次打开编辑框");
  await evaluate(`(() => {
    const area = document.querySelector('.queue-editor textarea');
    area.value = "改过之后的消息";
    area.dispatchEvent(new Event('input', { bubbles: true }));
    const save = [...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes("保存"));
    save.click();
    return true;
  })()`);
  await poll("!document.querySelector('.queue-editor')", "保存后编辑框应关闭");
  {
    const calls = JSON.parse(await evaluate("JSON.stringify(window.__queueEditCalls)"));
    assert.equal(calls.length, 2, `应只提交两次编辑（带附件那条 + 这条），实际 ${calls.length}`);
    const last = calls.at(-1);
    assert.equal(last.next.message, "改过之后的消息", "保存的是新文字");
    assert.deepEqual(last.next.addPaths, [], "没有新粘贴附件时 addPaths 为空");
    assert.equal(last.target.text, "只存在于队列里的消息", "要带上原来的队列项用于定位");
    assert.equal(last.target.mode, "followUp", "模式要对");
  }

  // 3) Esc 取消不发请求
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "再次打开编辑框");
  await evaluate(`(() => {
    const area = document.querySelector('.queue-editor textarea');
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await wait(200);
  assert.equal(await evaluate("document.querySelectorAll('.queue-editor').length"), 0, "Esc 应关闭编辑框");
  assert.equal(
    JSON.parse(await evaluate("JSON.stringify(window.__queueEditCalls)")).length,
    2,
    "取消不应提交编辑",
  );

  // 4) 卡片右侧的编辑图标同样能进入编辑
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-icon:not(.is-withdraw)')?.click();
    return Boolean(card);
  })()`).then((ok) => assert.ok(ok, "待发送卡片上应有编辑图标"));
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "卡片上的编辑应打开编辑框");
  {
    const value = await evaluate("document.querySelector('.queue-editor textarea').value");
    assert.equal(value, "只存在于队列里的消息", `编辑框应预填这条消息的内容，实际「${value}」`);
  }
  await evaluate("[...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes('取消'))?.click(); true");
  await wait(200);

  // ---- 单条撤回 ----
  await evaluate(`(() => {
    window.__queueWithdrawCalls = [];
    const workbench = window.__piDesktop.workbench;
    window.__queueWithdrawOriginal = workbench.withdrawQueued;
    workbench.withdrawQueued = async (target) => {
      window.__queueWithdrawCalls.push({ target });
      return true;
    };
    return true;
  })()`);
  {
    const buttons = JSON.parse(await evaluate(`(() => JSON.stringify(
      [...document.querySelectorAll('.queue-card')].map((card) => ({
        text: card.querySelector('.queue-card-text')?.textContent.trim().slice(0, 12) ?? '',
        actions: [...card.querySelectorAll('.queue-card-actions button')].map(
          (n) => n.getAttribute('aria-label') ?? n.getAttribute('title') ?? '',
        ),
      })),
    ))()`));
    assert.ok(buttons.length >= 1, "应有待发送卡片");
    for (const card of buttons) {
      assert.equal(card.actions.length, 2, `每张卡片两个图标：${card.text}`);
      assert.ok(card.actions[0]?.includes("编辑"), `第一个图标是编辑：${JSON.stringify(card.actions)}`);
      assert.ok(card.actions[1]?.includes("撤回"), `第二个图标是撤回：${JSON.stringify(card.actions)}`);
    }
  }
  // 点第二条的「撤回」：只撤回那一条，参数带原始提示词
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.queue-card')];
    const card = cards.find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    if (!card) return false;
    card.querySelector('.queue-card-icon.is-withdraw')?.click();
    return true;
  })()`).then((ok) => assert.ok(ok, "应能找到那条待发送卡片"));
  await wait(300);
  {
    const calls = JSON.parse(await evaluate("JSON.stringify(window.__queueWithdrawCalls)"));
    assert.equal(calls.length, 1, `应只撤回一条，实际 ${calls.length}`);
    assert.equal(calls[0].target.text, "只存在于队列里的消息", "撤回要带上原始提示词用于定位");
    assert.equal(calls[0].target.mode, "followUp", "模式要对");
  }
  await evaluate(`(() => {
    window.__piDesktop.workbench.withdrawQueued = window.__queueWithdrawOriginal;
    return true;
  })()`);

  // ---- 发出后气泡挪到末尾（顺序回归）----
  {
    const order = JSON.parse(await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      for (const block of [...thread.blocks]) thread.transcript.removeBlock(block.id);
      const queuedBlock = thread.transcript.pushUser("排队的那条", 0, { queueText: "排队的那条" });
      thread.transcript.pushUser("上一轮输出", 0, { queueText: "" });
      const beforeIds = thread.blocks.map((b) => b.id);
      const moved = thread.transcript.moveBlockToEnd(queuedBlock.id);
      const afterIds = thread.blocks.map((b) => b.id);
      for (const block of [...thread.blocks]) thread.transcript.removeBlock(block.id);
      return JSON.stringify({ moved, beforeIds, afterIds, queuedId: queuedBlock.id });
    })()`));
    assert.equal(order.moved, true, "不在末尾的块应该被移动");
    assert.equal(order.afterIds.at(-1), order.queuedId, `移动后应该排在最后：${JSON.stringify(order.afterIds)}`);
    assert.equal(order.beforeIds.at(-1), order.beforeIds[1], "初始时排队气泡不在末尾");
  }

  // 还原 editQueued
  await evaluate(`(() => {
    window.__piDesktop.workbench.editQueued = window.__queueEditOriginal;
    return true;
  })()`);

  // 截图：编辑态的排队消息（人工确认排版）
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "截图用编辑框");
  {
    const shot = async (name) => {
      try {
        const dbg = win.webContents.debugger;
        if (!dbg.isAttached()) await dbg.attach("1.3");
        const result = await Promise.race([
          dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
          new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        if (!result?.data) return `${name}（跳过）`;
        const { writeFile } = await import("node:fs/promises");
        const nodePath = await import("node:path");
        const { tmpdir } = await import("node:os");
        await writeFile(nodePath.join(tmpdir(), name), Buffer.from(result.data, "base64"));
        return name;
      } catch (error) {
        return `${name}（失败：${error?.message ?? error}）`;
      } finally {
        if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      }
    };
    console.log("[queue] shot", await shot("queue-edit-dark.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
    await wait(400);
    console.log("[queue] shot", await shot("queue-edit-light.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
    await wait(200);
  }
  await evaluate("[...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes('取消'))?.click(); true");
  await wait(200);
  // 队列被消费（清空）后：气泡标记与卡片都要消失
  await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    thread.queue = { steering: [], followUp: [] };
    return true;
  })()`);
  await poll("!document.querySelector('.queue-card')", "队列清空后「待发送」要消失");
  assert.equal(await evaluate("document.querySelectorAll('.queue-card').length"), 0, "队列清空后不应残留卡片");

  // 气泡里的顺序：附件（图片 / 文件）在文字上方，和输入框里的顺序一致
  await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    const block = thread.transcript.pushUser("这条消息带图和文件", 1, {
      imageItems: [{ mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }],
      attachments: [{ path: "C:\\tmp\\note.txt", name: "note.txt", kind: "file", size: 12 }],
    });
    block.id = "order-a";
    return true;
  })()`);
  await poll(`Boolean(document.querySelector('[data-block-id="order-a"] .msg-user-bubble'))`, "带附件的气泡应渲染");
  {
    const order = JSON.parse(await evaluate(`(() => {
      const bubble = document.querySelector('[data-block-id="order-a"] .msg-user-bubble');
      const pick = (selector) => bubble.querySelector(selector);
      const top = (node) => (node ? Math.round(node.getBoundingClientRect().top) : null);
      const text = pick(".msg-user-text");
      const images = pick(".msg-user-images");
      const files = pick(".msg-user-files");
      return JSON.stringify({
        hasText: Boolean(text),
        hasImages: Boolean(images),
        hasFiles: Boolean(files),
        textTop: top(text),
        imagesTop: top(images),
        filesTop: top(files),
        firstChild: bubble.firstElementChild?.className ?? "",
      });
    })()`));
    assert.ok(order.hasImages && order.hasFiles && order.hasText, `附件与文字都要渲染：${JSON.stringify(order)}`);
    assert.ok(order.imagesTop < order.filesTop, `图片应在文件上方：${JSON.stringify(order)}`);
    assert.ok(order.filesTop < order.textTop, `附件必须在文字上方（与输入框一致）：${JSON.stringify(order)}`);
  }
  // 截图留档：气泡里附件在上、文字在下（人工核对排版）
  try {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const box = JSON.parse(await evaluate(`(() => {
      const bubble = document.querySelector('[data-block-id="order-a"] .msg-user-bubble');
      const r = bubble.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left) - 14, y: Math.round(r.top) - 14, width: Math.round(r.width) + 28, height: Math.round(r.height) + 28 });
    })()`));
    const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
    const { writeFile } = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const { tmpdir } = await import("node:os");
    await writeFile(nodePath.join(tmpdir(), "bubble-order.png"), Buffer.from(shot.data, "base64"));
    console.log("[queue] shot bubble-order.png");
  } catch (error) {
    console.log("[queue] shot bubble-order.png（跳过）", error?.message ?? error);
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
  }
  await evaluate(`(() => {
    window.__piDesktop.workbench.active.value.activeThread.transcript.removeBlock("order-a");
    return true;
  })()`);

  // 清理注入的块，并把被打桩的内核方法还原（后面的步骤还要用真的实现）
  await evaluate(`(() => {
    const workbench = window.__piDesktop.workbench;
    if (window.__queueEditOriginal) workbench.editQueued = window.__queueEditOriginal;
    if (window.__stageOriginal) workbench.stagePastedAttachment = window.__stageOriginal;
    if (window.__queueWithdrawOriginal) workbench.withdrawQueued = window.__queueWithdrawOriginal;
    const thread = workbench.active.value.activeThread;
    thread.transcript.removeBlock("queue-a");
    thread.transcript.removeBlock("queue-b");
    return true;
  })()`);

  // ---- 文件名优先：窄窗口 + 超长名字，名字不能被徽标 / 体积挤没 ----
  {
    const [width, height] = win.getSize();
    const longName = path.join(attachDir, "a-very-long-screenshot-name-for-the-queue-card-2026.png");
    await writeFile(longName, "x".repeat(1024 * 1024));
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      const attach = ${JSON.stringify(longName)};
      const prompt = '<file name="' + attach + '">' + String.fromCharCode(10) + 'x' + String.fromCharCode(10) + '</file>' + String.fromCharCode(10) + '看图';
      thread.queue = { steering: [], followUp: [prompt] };
      return true;
    })()`);
    win.setSize(760, 800);
    await poll("Boolean(document.querySelector('.queue-file-name'))", "长名字附件出现");
    await wait(400);
    const fileView = JSON.parse(
      await evaluate(`(() => {
        const file = document.querySelector('.queue-file-name');
        return JSON.stringify({
          name: file?.textContent?.trim() ?? '',
          nameWidth: Math.round(file?.getBoundingClientRect().width ?? 0),
        });
      })()`),
    );
    assert.match(fileView.name, /^a-very-long/, `文件名要在，实际「${fileView.name}」`);
    assert.ok(fileView.nameWidth >= 60, `窄窗口下文件名仍要看得见，实测 ${fileView.nameWidth}px`);
    win.setSize(width, height);
    await wait(300);
  }

  await rm(attachDir, { recursive: true, force: true }).catch(() => {});
  console.log("[queue] PASS 单次展示 / 气泡标记 / 卡片预览 / 编辑 / 撤回入口 / 清空回收", ids.a, ids.b);
}
