/**
 * Conn helpers — gwejh 1.0.6 (port ala Ponta mbuilder, versi ringan).
 *
 * Tujuannya: panggil fitur kirim cukup lewat `conn`, satu baris,
 * tanpa `generateWAMessage` / `relayMessage` manual:
 *
 *   await conn.sendText(jid, 'halo')
 *   await conn.sendButtons(jid, 'Pilih:', ['Ya', 'Tidak'])
 *   await conn.sendButtons(jid, 'Pilih:', [
 *     { type: 'quick', label: 'Ya', id: 'yes' },
 *     { type: 'url', label: 'Buka web', url: 'https://example.com' },
 *     { type: 'copy', label: 'Salin kode', code: 'ABC123' },
 *     { type: 'call', label: 'Telepon', phone: '6281234567890' },
 *     { type: 'list', label: 'Menu', sections: [{ title: 'Menu', rows: [{ title: 'A', rowId: 'a' }] }] },
 *   ])
 *   await conn.sendList(jid, 'Pilih menu:', 'Lihat menu', [{ title: 'Menu', rows: [{ title: 'A', rowId: 'a' }] }])
 *   await conn.sendCarousel(jid, [{ title: 'Kartu 1', body: 'Isi kartu', buttons: [{ type: 'quick', label: 'OK', id: 'ok' }] }])
 *   await conn.sendAIRich(jid, richResponseObject)
 *
 * Gaya builder ala Ponta (tanpa dependensi berat sharp/ffmpeg):
 *   await new Button(conn, 'Pilih:').addQuick('yes', 'Ya').addUrl('Web', 'https://example.com').send(jid)
 *   await new Carousel(conn).addCard({ title: 'Kartu 1', body: 'Isi' }).send(jid)
 *   await new AIRich(conn).setResponse(richResponseObject).send(jid)
 *
 * Semua helper ini HANYA membangun objek content lalu memanggil
 * conn.sendMessage — pengiriman lewat proto tetap ditangani patch
 * messages-send.js gwejh (raw native-flow / carousel / AI rich).
 * Tidak ada pemrosesan media di sini: kartu carousel bertanda
 * image/video tetap bisa dilewatkan sebagai objek media Baileys
 * (prepareWAMessageMedia di patch yang mengurusnya).
 */

import { prepareRichResponseMessage, generateTableContent, generateCodeBlockContent, Rich } from './rich-helpers.js';

const asButton = (b, i = 0) => {
    if (typeof b === 'string') {
        return { type: 'quick', displayText: b, id: b };
    }
    const label = b.displayText || b.display_text || b.text || b.label || b.title || `Button ${i + 1}`;
    const type = String(b.type || b.kind || b.buttonType || 'quick').toLowerCase();
    const out = { type, displayText: label };
    if (b.id || b.buttonId || b.rowId || b.command || b.cmd || b.value) {
        out.id = b.id || b.buttonId || b.rowId || b.command || b.cmd || b.value;
    }
    if (b.url || b.link || b.href) out.url = b.url || b.link || b.href;
    if (b.copy_code || b.copyCode || b.code) out.code = b.copy_code || b.copyCode || b.code;
    if (b.phone_number || b.phoneNumber || b.phone || b.number) out.phone_number = b.phone_number || b.phoneNumber || b.phone || b.number;
    if (b.sections || b.rows) {
        out.sections = b.sections || [{ title: b.sectionTitle || 'Menu', rows: b.rows }];
        if (b.title) out.title = b.title;
    }
    if (b.buttonParamsJson) out.buttonParamsJson = b.buttonParamsJson;
    if (b.paramsJson) out.paramsJson = b.paramsJson;
    return out;
};

export const buildButtonsContent = (text, buttons = [], options = {}) => {
    const content = {
        text,
        interactiveButtons: (Array.isArray(buttons) ? buttons : []).map((b, i) => asButton(b, i)),
    };
    if (options.footer) content.footer = options.footer;
    if (options.title) content.title = options.title;
    if (options.subtitle) content.subtitle = options.subtitle;
    if (options.header) content.header = options.header;
    if (options.image || options.video || options.document) {
        if (options.image) content.image = options.image;
        if (options.video) content.video = options.video;
        if (options.document) content.document = options.document;
    }
    return content;
};

export const buildListContent = (text, buttonText, sections = [], options = {}) => {
    const content = {
        text,
        interactiveButtons: [{
            type: 'list',
            displayText: buttonText || 'Lihat menu',
            title: buttonText || 'Lihat menu',
            sections: Array.isArray(sections) ? sections : [],
        }],
    };
    if (options.footer) content.footer = options.footer;
    if (options.title) content.title = options.title;
    return content;
};

export const buildCarouselContent = (cards = [], options = {}) => {
    const content = {
        carousel: {
            cards: Array.isArray(cards) ? cards : [],
        },
    };
    if (options.body || options.text) content.carousel.body = options.body || options.text;
    if (options.footer) content.carousel.footer = options.footer;
    if (options.text) content.text = options.text;
    return content;
};

export const buildAIRichContent = (richResponse) => ({ richResponse });

/** Pasang helper ke objek socket (dipanggil dari makeMessagesSocket). */
export const attachConnHelpers = (sock) => {
    sock.sendText = (jid, text, options = {}) => sock.sendMessage(jid, { text }, options);
    sock.sendButtons = (jid, text, buttons, options = {}) => sock.sendMessage(jid, buildButtonsContent(text, buttons, options), options);
    sock.sendList = (jid, text, buttonText, sections, options = {}) => sock.sendMessage(jid, buildListContent(text, buttonText, sections, options), options);
    sock.sendCarousel = (jid, cards, options = {}) => sock.sendMessage(jid, buildCarouselContent(cards, options), options);
    sock.sendAIRich = (jid, richResponse, options = {}) => sock.sendMessage(jid, buildAIRichContent(richResponse), options);

    // ── AI Rich Response penuh (teks/kode/tabel/gambar/video/HTML/dll) ──
    // richInput: objek flat Ponta (contentText, richHtml, code, table, ...)
    // atau { richResponse: [...] } (array urutan bebas), atau instance Rich.
    sock.sendRich = (jid, richInput, options = {}) => {
        const prepared = richInput instanceof Rich ? richInput.build() : prepareRichResponseMessage(richInput);
        return sock.sendMessage(jid, prepared, options);
    };
    // Tabel mandiri: sendTable(jid, 'Harga', ['Barang','Harga'], [['Kopi','10rb']])
    sock.sendTable = (jid, title, headers, rows, options = {}) =>
        sock.sendMessage(jid, generateTableContent(title, headers, rows, null, options).message, options);
    // Blok kode mandiri: sendCode(jid, "console.log(1)", { language: 'javascript' })
    sock.sendCode = (jid, code, options = {}) =>
        sock.sendMessage(jid, generateCodeBlockContent(code, null, { language: options.language || 'javascript', ...options }).message, options);
    // HTML mandiri: sendHtml(jid, '<h1>Judul</h1><p>Isi</p>')
    sock.sendHtml = (jid, html, options = {}) =>
        sock.sendMessage(jid, prepareRichResponseMessage({ richHtml: html, ...options }), options);
    return sock;
};

/** Builder ala Ponta — Button. */
export class Button {
    constructor(conn, text = '') {
        this.conn = conn;
        this.text = text;
        this.buttons = [];
        this.footer = undefined;
    }
    setText(text) { this.text = text; return this; }
    setFooter(footer) { this.footer = footer; return this; }
    addQuick(id, label) { this.buttons.push({ type: 'quick', displayText: label || id, id }); return this; }
    addUrl(label, url) { this.buttons.push({ type: 'url', displayText: label, url }); return this; }
    addCopy(label, code) { this.buttons.push({ type: 'copy', displayText: label, code }); return this; }
    addCall(label, phone) { this.buttons.push({ type: 'call', displayText: label, phone_number: phone }); return this; }
    addList(label, sections) { this.buttons.push({ type: 'list', displayText: label, sections }); return this; }
    build() { return buildButtonsContent(this.text, this.buttons, { footer: this.footer }); }
    send(jid, options = {}) { return this.conn.sendMessage(jid, this.build(), options); }
}

/** Builder ala Ponta — Carousel. */
export class Carousel {
    constructor(conn) {
        this.conn = conn;
        this.cards = [];
        this.body = undefined;
        this.footer = undefined;
    }
    setBody(body) { this.body = body; return this; }
    setFooter(footer) { this.footer = footer; return this; }
    addCard(card) { this.cards.push(card); return this; }
    build() { return buildCarouselContent(this.cards, { body: this.body, footer: this.footer }); }
    send(jid, options = {}) { return this.conn.sendMessage(jid, this.build(), options); }
}

/** Builder ala Ponta — AIRich (thin wrapper; isi richResponse tetap objek mentah). */
export class AIRich {
    constructor(conn) {
        this.conn = conn;
        this.richResponse = undefined;
    }
    setResponse(richResponse) { this.richResponse = richResponse; return this; }
    build() { return buildAIRichContent(this.richResponse); }
    send(jid, options = {}) { return this.conn.sendMessage(jid, this.build(), options); }
}
