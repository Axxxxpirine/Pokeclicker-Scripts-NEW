const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
function events() {
    const event = { title: "A Pirate's Life", description: 'Pirates', hasStarted: () => false, start() { this.started = true; }, end() { this.started = false; } };
    const notices = [];
    const h = load('custom/infiniteseasonalevents.user.js', '<div id="startMenu"><ul><li><a href="#eventsModal">Events</a></li></ul></div><div id="profileModal"></div>', {
        App: { isUsingClient: true, game: { specialEvents: { events: [event], newEvent() {} } } },
        Notifier: { notify: n => notices.push(n) }, NotificationConstants: { NotificationOption: { danger: 1 } },
        pokemonList: [{ name: 'Captain Charizard', id: 6.99 }, { name: 'Magikarp (Pirate)', id: 129.99 }, { name: 'Pikachu', id: 25 }],
    });
    h.w.initEvents();
    return { ...h, notices, event };
}
test('Pirate event has images and unknown event counts do not issue false outdated alarms', () => {
    const h = events();
    assert.equal(h.notices.length, 0);
    assert.equal(h.w.document.querySelectorAll('.event-select img').length, 2);
    const card = h.w.document.getElementById("event-A Pirate's Life");
    card.click();
    assert.equal(h.event.started, true);
    card.click();
    assert.equal(h.event.started, false);
    assert.equal(h.w.localStorage.getItem("A Pirate's Life"), 'false');
});
