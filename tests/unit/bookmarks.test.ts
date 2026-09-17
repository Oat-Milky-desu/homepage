import { describe, expect, it } from 'vitest';
import { parseBookmarksHtml, planImport } from '../../src/utils/bookmarks';
import { dedupeKey } from '../../src/shared/url';

const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1690000000" LAST_MODIFIED="1690000001" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://example.com/" ADD_DATE="1690000000" DESCRIPTION="示例站点">Example</A>
        <DT><H3 ADD_DATE="1690000000">子文件夹</H3>
        <DL><p>
            <DT><A HREF="https://example.org/docs">Org Docs</A>
            <DD>文档站
        </DL><p>
        <DT><A HREF="https://top.example.com/">Top</A>
    </DL><p>
    <DT><A HREF="javascript:alert(1)">Dangerous</A>
    <DT><A HREF="plain.example.com">NoScheme</A>
    <DT><A HREF="https://example.com/">Duplicate</A>
</DL><p>
`;

describe('浏览器书签 HTML 解析', () => {
  it('递归解析 Chrome 风格的嵌套文件夹', () => {
    const result = parseBookmarksHtml(CHROME_EXPORT);
    expect(result.folders.map((folder) => folder.path.join('/'))).toEqual([
      '书签栏',
      '书签栏/子文件夹',
      '',
    ]);

    const toolbar = result.folders.find((folder) => folder.path.join('/') === '书签栏')!;
    expect(toolbar.links.map((link) => link.name)).toEqual(['Example', 'Top']);
    expect(toolbar.links[0]!.description).toBe('示例站点');

    const nested = result.folders.find((folder) => folder.path.join('/') === '书签栏/子文件夹')!;
    expect(nested.links).toHaveLength(1);
    expect(nested.links[0]!.url).toBe('https://example.org/docs');
    expect(nested.links[0]!.description).toBe('文档站');

    const rootFolder = result.folders.find((folder) => folder.path.length === 0)!;
    expect(rootFolder.links.map((link) => link.name)).toEqual(['NoScheme']);
    expect(rootFolder.links[0]!.url).toBe('https://plain.example.com');

    expect(result.total).toBe(6);
    const reasons = result.skipped.map((item) => item.reason);
    expect(reasons).toContain('invalid');
    expect(reasons).toContain('duplicate');
  });

  it('支持把 <DL> 嵌套在 <DT> 内部的导出格式', () => {
    const html = `<DL><p>
      <DT><H3>收藏夹</H3><DL><p>
        <DT><A HREF="https://a.example.com">A</A>
        <DT><H3>深层</H3><DL><p><DT><A HREF="https://b.example.com">B</A></DL>
      </DL>
    </DL>`;
    const result = parseBookmarksHtml(html);
    expect(result.folders.map((folder) => folder.path.join('/'))).toEqual(['收藏夹', '收藏夹/深层']);
    expect(result.folders[1]!.links[0]!.url).toBe('https://b.example.com');
  });

  it('对畸形或空文件保持健壮，不抛出异常', () => {
    expect(parseBookmarksHtml('').folders).toEqual([]);
    expect(parseBookmarksHtml('<html><body>没有书签</body></html>').folders).toEqual([]);
    expect(parseBookmarksHtml('<DL><DT>没有链接</DT></DL>').folders).toEqual([]);
    const unclosed = parseBookmarksHtml('<DL><DT><A HREF="https://x.example.com">X</A>');
    expect(unclosed.folders[0]!.links).toHaveLength(1);
  });

  it('把书名与标签当作纯文本，不执行也不注入 HTML', () => {
    const html = `<DL><DT><A HREF="https://safe.example.com">&lt;img src=x onerror=alert(1)&gt;</A></DL>`;
    const result = parseBookmarksHtml(html);
    expect(result.folders[0]!.links[0]!.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('限制最大链接数量', () => {
    const links = Array.from({ length: 30 }, (_, index) => `<DT><A HREF="https://site${index}.example.com">S${index}</A>`).join('');
    const result = parseBookmarksHtml(`<DL>${links}</DL>`, { maxLinks: 10 });
    const total = result.folders.reduce((sum, folder) => sum + folder.links.length, 0);
    expect(total).toBe(10);
    expect(result.total).toBe(30);
  });
});

describe('导入计划', () => {
  it('按文件夹生成分组并合并同名文件夹', () => {
    const parsed = parseBookmarksHtml(CHROME_EXPORT);
    const plan = planImport(parsed, { mode: 'folders' });
    expect(plan.groups.map((group) => group.name)).toEqual(['书签栏', '书签栏 / 子文件夹', '未分组']);
    expect(plan.totalLinks).toBe(4);
    expect(plan.skipped.some((item) => item.reason === 'duplicate')).toBe(true);
  });

  it('可以合并到单个分组并跳过已存在的链接', () => {
    const parsed = parseBookmarksHtml(CHROME_EXPORT);
    const existing = parsed.folders
      .flatMap((folder) => folder.links)
      .filter((link) => link.url.includes('example.org'))
      .map((link) => dedupeKey(link.url));
    const plan = planImport(parsed, { mode: 'single', singleGroupName: '导入', existingUrlKeys: existing });
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.name).toBe('导入');
    expect(plan.skippedExisting).toBe(1);
    expect(plan.totalLinks).toBe(3);
  });

  it('空文件产生空计划', () => {
    const plan = planImport(parseBookmarksHtml(''), { mode: 'folders' });
    expect(plan.groups).toEqual([]);
    expect(plan.totalLinks).toBe(0);
  });
});
