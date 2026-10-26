const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function observable(value) {
    const fn = (...args) => args.length ? (value = args[0]) : value;
    fn.subscribe = () => {};
    return fn;
}
function load(file, html = '', globals = {}, storage = {}) {
    const dom = new JSDOM(`<html><head></head><body>${html}</body></html>`, { url: 'https://www.pokeclicker.com/', runScripts: 'outside-only' });
    const w = dom.window;
    const timers = new Map();
    let id = 0;
    Object.assign(w, { console, App: { isUsingClient: true, game: {} }, setInterval: fn => { timers.set(++id, fn); return id; }, clearInterval: n => timers.delete(n), setTimeout: fn => { const timeoutId = ++id; timers.set(timeoutId, () => { timers.delete(timeoutId); fn(); }); return timeoutId; }, clearTimeout: n => timers.delete(n), ...globals });
    for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, JSON.stringify(v));
    w.$ = selector => ({ unwrap() { const el = w.document.querySelector(selector); el.parentElement.replaceWith(...el.parentElement.childNodes); } });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
    return { w, dom, timers, run: source => vm.runInContext(source, context, { timeout: 200 }), tick: () => [...timers.values()].forEach(fn => fn()) };
}
module.exports = { load, observable };
