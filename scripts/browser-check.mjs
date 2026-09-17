#!/usr/bin/env node
/**
 * 响应式浏览器验收脚本（可选，本机需安装 Chrome 或 Edge）。
 *
 * 用法：
 *   npm run build
 *   npm run db:migrate:local          # 需要空的本地数据库，脚本会走一次完整的初始化流程
 *   npm run preview                   # 另开一个终端
 *   node scripts/browser-check.mjs --init-secret <与 .dev.vars 一致的 INIT_SECRET>
 *
 * 脚本通过 Chrome DevTools Protocol 在真实浏览器中：
 *   1. 完成 /setup 初始化并进入首页
 *   2. 用界面创建分组与链接
 *   3. 在桌面（1440×900）与手机（390×844）两种视口下检查渲染与横向溢出
 *   4. 输出截图到 .tmp/browser-check/
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? 'http://127.0.0.1:8788';
const initSecret = args['init-secret'] ?? process.env.INIT_SECRET ?? '';
const outDir = args.out ?? path.join('.tmp', 'browser-check');
const username = args.username ?? 'browseradmin';
const password = args.password ?? 'Br0wser-Pass!2026';

if (!initSecret) {
  console.error('缺少 --init-secret（或环境变量 INIT_SECRET），无法完成初始化流程。');
  process.exit(2);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(target, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(target);
      if (response.ok) return await response.json();
    } catch {
      /* 浏览器还没起来 */
    }
    await sleep(250);
  }
  throw new Error(`无法连接调试端口：${target}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    this.consoleErrors = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method} 失败：${JSON.stringify(message.error)}`));
        else entry.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        this.consoleErrors.push(details?.exception?.description ?? details?.text ?? '未知异常');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.consoleErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description).join(' '));
      }
      const listeners = this.events.get(message.method) ?? [];
      listeners.forEach((listener) => listener(message.params));
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) ?? [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`页面脚本异常：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, description, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.evaluate(`(() => { try { return Boolean(${expression}); } catch { return false; } })()`);
      if (value) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${description}`);
      await sleep(200);
    }
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
  }

  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(file, Buffer.from(result.data, 'base64'));
  }
}

const SET_VALUE = `(selector, value) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error('找不到元素：' + selector);
  const proto = el.constructor.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}`;

const CLICK_TEXT = `(text, scopeSelector) => {
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
  if (!scope) throw new Error('找不到容器：' + scopeSelector);
  const target = [...scope.querySelectorAll('button, a, label, summary')].find((el) => el.textContent.trim().includes(text));
  if (!target) throw new Error('找不到可点击元素：' + text);
  target.click();
  return true;
}`;

const OVERFLOW_CHECK = `(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
}))()`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('未找到 Chrome / Edge，可设置 CHROME_PATH 环境变量后重试。');
    process.exit(2);
  }

  const port = 9333;
  const profile = mkdtempSync(path.join(tmpdir(), 'nav-browser-'));
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const target = await targetResponse.json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // 1) 首屏 → 初始化向导或登录页（脚本可重复执行）
    await cdp.send('Page.navigate', { url });
    await cdp.waitFor(`document.querySelector('.auth-form')`, '登录 / 初始化表单');
    const needsSetup = await cdp.evaluate(`document.querySelector('h1')?.textContent.includes('初始化') ?? false`);
    if (needsSetup) {
      record('打开站点并进入初始化向导', true);
      await cdp.screenshot(path.join(outDir, '01-setup.png'));
      await cdp.evaluate(`(${SET_VALUE})('input[type="password"]', ${JSON.stringify(initSecret)})`);
      await cdp.evaluate(`(() => {
        const inputs = [...document.querySelectorAll('input')];
        const set = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
          if (setter) setter.call(el, value); else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set(inputs.find((el) => el.type === 'text'), ${JSON.stringify(username)});
        const passwords = inputs.filter((el) => el.type === 'password');
        set(passwords[1], ${JSON.stringify(password)});
        set(passwords[2], ${JSON.stringify(password)});
        return true;
      })()`);
      await cdp.evaluate(`(${CLICK_TEXT})('完成初始化', 'form')`);
      await cdp.waitFor(`document.querySelector('.home')`, '进入首页', 25000);
      record('完成初始化并进入首页', await cdp.evaluate(`location.pathname === '/'`));
    } else {
      record('打开站点并进入登录页', true);
      await cdp.screenshot(path.join(outDir, '01-login.png'));
      await cdp.evaluate(`(() => {
        const set = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
          if (setter) setter.call(el, value); else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const inputs = [...document.querySelectorAll('.auth-form input')];
        set(inputs.find((el) => el.type === 'text'), ${JSON.stringify(username)});
        set(inputs.find((el) => el.type === 'password'), ${JSON.stringify(password)});
        return true;
      })()`);
      await cdp.evaluate(`(${CLICK_TEXT})('登录', 'form')`);
      await cdp.waitFor(`document.querySelector('.home')`, '进入首页', 25000);
      record('登录成功并进入首页', await cdp.evaluate(`location.pathname === '/'`));
    }

    // 3) 通过界面创建分组与链接（已存在时跳过，保证脚本可重复执行）
    await cdp.evaluate(`(${CLICK_TEXT})('编辑模式')`);
    const hasGroup = await cdp.evaluate(`[...document.querySelectorAll('.group-toggle h2')].some((el) => el.textContent.includes('工作'))`);
    if (!hasGroup) {
      await cdp.waitFor(`document.querySelector('.empty') || document.querySelector('.add-group-btn')`, '空状态或新建分组按钮');
      await cdp.evaluate(
        `(() => {
          const empty = document.querySelector('.empty button');
          if (empty) { empty.click(); return true; }
          const add = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('新建分组'));
          if (add) { add.click(); return true; }
          throw new Error('找不到新建分组入口');
        })()`,
      );
      await cdp.waitFor(`document.querySelector('[role="dialog"]')`, '分组对话框');
      await cdp.evaluate(`(${SET_VALUE})('[role="dialog"] input[type="text"]', '工作')`);
      await cdp.evaluate(`(${CLICK_TEXT})('保存', '[role="dialog"]')`);
      await cdp.waitFor(`[...document.querySelectorAll('.group-toggle h2')].some((el) => el.textContent.includes('工作'))`, '分组出现');
    }

    const hasLink = await cdp.evaluate(`[...document.querySelectorAll('.link-name')].some((el) => el.textContent.includes('GitHub'))`);
    if (!hasLink) {
      await cdp.evaluate(`(${CLICK_TEXT})('+ 链接')`);
      await cdp.waitFor(`document.querySelector('[role="dialog"]')`, '链接对话框');
      await cdp.evaluate(`(${SET_VALUE})('[role="dialog"] input[type="text"]', 'GitHub')`);
      await cdp.evaluate(`(${SET_VALUE})('[role="dialog"] input[type="url"]', 'https://github.com')`);
      await cdp.evaluate(`(${CLICK_TEXT})('保存', '[role="dialog"]')`);
      await cdp.waitFor(`[...document.querySelectorAll('.link-name')].some((el) => el.textContent.includes('GitHub'))`, '链接卡片');
    }
    record('通过界面创建分组与链接', await cdp.evaluate(`[...document.querySelectorAll('.link-name')].some((el) => el.textContent.includes('GitHub'))`));

    // 4) 桌面视口检查
    await cdp.setViewport(1440, 900);
    await sleep(400);
    const desktop = await cdp.evaluate(OVERFLOW_CHECK);
    record('桌面视口无横向溢出', !desktop.overflowing, `${desktop.scrollWidth}px / ${desktop.innerWidth}px`);
    record('桌面可见分组标题与卡片', await cdp.evaluate(`Boolean(document.querySelector('.group-toggle') && document.querySelector('.link-card'))`));
    await cdp.screenshot(path.join(outDir, '02-home-desktop.png'));

    // 5) 手机视口检查
    await cdp.setViewport(390, 844);
    await sleep(400);
    const mobile = await cdp.evaluate(OVERFLOW_CHECK);
    record('移动视口无横向溢出', !mobile.overflowing, `${mobile.scrollWidth}px / ${mobile.innerWidth}px`);
    const mobileCardWidth = await cdp.evaluate(`(() => {
      const card = document.querySelector('.link-card');
      if (!card) return 0;
      const rect = card.getBoundingClientRect();
      return Math.round(rect.width);
    })()`);
    record('移动视口卡片自适应宽度', mobileCardWidth > 150 && mobileCardWidth <= 390, `${mobileCardWidth}px`);
    await cdp.evaluate(`document.querySelector('.topbar')?.scrollIntoView({ block: 'start' })`);
    await cdp.screenshot(path.join(outDir, '03-home-mobile.png'));

    // 6) 管理后台在移动视口下可用
    await cdp.evaluate(`(${CLICK_TEXT})('设置')`);
    await cdp.waitFor(`document.querySelector('.admin-tabs')`, '设置页');
    const admin = await cdp.evaluate(OVERFLOW_CHECK);
    record('设置页移动视口无横向溢出', !admin.overflowing, `${admin.scrollWidth}px / ${admin.innerWidth}px`);
    await cdp.evaluate(`(${CLICK_TEXT})('外观样式', '.admin-tabs')`);
    await cdp.waitFor(`document.querySelector('input[type="range"]')`, '外观滑块');
    record('外观设置渲染滑杆', await cdp.evaluate(`document.querySelectorAll('input[type="range"]').length >= 3`));
    await cdp.screenshot(path.join(outDir, '04-admin-appearance-mobile.png'));

    // 7) 外观设置真实生效：卡片不透明度 / 毛玻璃（回归检查 CSS 变量作用域）
    const targets = await cdp.evaluate(`(() => {
      const ranges = [...document.querySelectorAll('.admin-panel input[type="range"]')];
      if (ranges.length < 3) throw new Error('滑杆数量不足');
      const set = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      // 与当前值错开，保证表单进入“未保存”状态（脚本可重复执行）
      const opacity = ranges[1].value === '0.2' ? '0.3' : '0.2';
      const blur = ranges[2].value === '2' ? '4' : '2';
      set(ranges[1], opacity);
      set(ranges[2], blur);
      return { opacity, blur };
    })()`);
    await sleep(300);
    await cdp.evaluate(`(${CLICK_TEXT})('保存设置', '.save-bar')`);
    await cdp.waitFor(`!document.querySelector('.save-bar')`, '外观设置保存完成');
    await cdp.evaluate(`(${CLICK_TEXT})('返回导航')`);
    await cdp.waitFor(`document.querySelector('.home')`, '返回首页');
    await sleep(400);
    const cardStyle = await cdp.evaluate(`(() => {
      const card = document.querySelector('.link-card');
      if (!card) return null;
      const style = getComputedStyle(card);
      const backdrop =
        style.backdropFilter && style.backdropFilter !== 'none'
          ? style.backdropFilter
          : style.webkitBackdropFilter;
      return {
        background: style.backgroundColor,
        backdrop: backdrop === 'none' ? '' : backdrop,
        theme: document.documentElement.dataset.theme,
        rootOpacity: getComputedStyle(document.documentElement).getPropertyValue('--card-opacity').trim(),
        rootBlur: getComputedStyle(document.documentElement).getPropertyValue('--glass-blur').trim(),
      };
    })()`);
    const backgroundAlpha = Number((/([\d.]+)\)\s*$/.exec(cardStyle?.background ?? '') ?? [])[1] ?? NaN);
    // 浅色主题会在卡片不透明度基础上 +0.25（上限 1）
    const expectedAlpha = Math.min(1, Number(targets.opacity) + (cardStyle?.theme === 'light' ? 0.25 : 0));
    record(
      '卡片不透明度与毛玻璃设置真实生效',
      Boolean(
        cardStyle &&
          Math.abs(backgroundAlpha - expectedAlpha) < 0.011 &&
          cardStyle.backdrop.includes(`blur(${targets.blur}px)`),
      ),
      JSON.stringify({ ...cardStyle, targets, backgroundAlpha, expectedAlpha }),
    );

    // 8) 主题切换后回到首页并检查（浅色主题下派生变量仍然生效）
    await cdp.evaluate(`(${CLICK_TEXT})('设置')`);
    await cdp.waitFor(`document.querySelector('.admin-tabs')`, '设置页');
    await cdp.evaluate(`(${CLICK_TEXT})('外观样式', '.admin-tabs')`);
    await cdp.evaluate(`(${CLICK_TEXT})('浅色', '.admin-panel')`);
    await sleep(250);
    const hasUnsaved = await cdp.evaluate(`Boolean(document.querySelector('.save-bar'))`);
    if (hasUnsaved) {
      await cdp.evaluate(`(${CLICK_TEXT})('保存设置', '.save-bar')`);
      await cdp.waitFor(`!document.querySelector('.save-bar')`, '保存完成');
    }
    await cdp.evaluate(`(${CLICK_TEXT})('返回导航')`);
    await cdp.waitFor(`document.querySelector('.home')`, '返回首页');
    await sleep(300);
    const theme = await cdp.evaluate(`document.documentElement.dataset.theme`);
    record('浅色主题已应用并持久化', theme === 'light', `data-theme=${theme}`);
    const lightBlur = await cdp.evaluate(`(() => {
      const card = document.querySelector('.link-card');
      if (!card) return '';
      const style = getComputedStyle(card);
      const backdrop =
        style.backdropFilter && style.backdropFilter !== 'none'
          ? style.backdropFilter
          : style.webkitBackdropFilter;
      return backdrop === 'none' ? '' : backdrop;
    })()`);
    record('浅色主题下毛玻璃设置仍然生效', lightBlur.includes(`blur(${targets.blur}px)`), lightBlur);
    await cdp.setViewport(1440, 900);
    await sleep(300);
    await cdp.screenshot(path.join(outDir, '05-home-light.png'));

    // 9) 控制台错误
    record('浏览器控制台无未捕获错误', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));
  } catch (error) {
    record('脚本执行', false, error instanceof Error ? error.message : String(error));
  } finally {
    child.kill();
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n共 ${checks.length} 项检查，失败 ${failed.length} 项；截图目录：${outDir}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
