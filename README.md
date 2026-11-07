# Baileys — gwejh

<div align="center">

**Baileys gwejh** — library WhatsApp Web API berbasis WebSocket, fork dari
[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) dengan
tombol interaktif, carousel, AI Rich Response (teks / kode / tabel / HTML),
dan helper `conn` satu baris.

**Author:** [RFL-KSPULLX.null](https://github.com/KazumiAS011) ·
**Maintainer / Docs:** Eriri Kazumi ·
**Base upstream:** `@whiskeysockets/baileys` **7.0.0-rc14**

</div>

> [!CAUTION]
> Library ini **tidak berafiliasi** dengan WhatsApp atau Meta. Gunakan dengan
> tanggung jawab, sesuai Terms of Service WhatsApp. Jangan dipakai untuk spam,
> stalkerware, atau pengiriman massal.

## Kenapa gwejh?

Baileys resmi hanya menyediakan `conn.sendMessage` mentah. gwejh menambahkan
lapisan yang dipakai sehari-hari — tanpa dependensi berat (tanpa `sharp`,
tanpa `ffmpeg`, tanpa database):

- **Tombol** — quick reply, URL, salin kode, telepon, dan tombol list
- **List** — menu pilihan (single-select) ala WhatsApp Business
- **Carousel** — kartu bergambar/teks, tiap kartu punya tombol sendiri
- **AI Rich Response** — pesan kaya Meta AI: teks, kode ber-highlight,
  tabel, gambar, video, reels, produk, post, tip, saran (pill), metadata,
  widget, footer action, kartu, peta, LaTeX, dan **HTML**
- **Helper `conn`** — semua fitur di atas cukup satu baris, tanpa
  `generateWAMessage` / `relayMessage` manual
- **Builder ala Ponta** — `Button`, `Carousel`, `AIRich`, `Rich` (fluent API)
- **biz_bot** — flag bot bisnis di chat pribadi

## Install

```sh
npm install github:KazumiAS011/baileys-gwejh
# atau, setelah rilis npm:
npm install baileys-gwejh
```

Syarat: **Node.js >= 20** (disarankan 22+). Tidak butuh browser, Selenium,
atau Chromium — koneksi langsung lewat WebSocket.

```sh
git clone https://github.com/KazumiAS011/baileys-gwejh.git
cd baileys-gwejh
npm install
```

## Mulai Cepat

```js
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from 'baileys-gwejh'

const { state, saveCreds } = await useMultiFileAuthState('auth_info')
const conn = makeWASocket({ auth: state })

conn.ev.on('creds.update', saveCreds)
conn.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
        console.log('Koneksi putus, reconnect:', shouldReconnect)
    } else if (connection === 'open') {
        console.log('Terhubung ke WhatsApp')
    }
})

// Teks biasa
await conn.sendText('6281234567890@s.whatsapp.net', 'Halo!')
```

> Pairing code (tanpa scan QR):
> ```js
> if (!conn.authState.creds.registered) {
>     const code = await conn.requestPairingCode('6281234567890')
>     console.log('Kode pairing:', code)
> }
> ```

## Fitur & Cara Panggil

Semua helper di bawah sudah terpasang di objek `conn` — tidak perlu import
tambahan. `jid` = `628xxx@s.whatsapp.net` (chat pribadi) atau
`1203xxx@g.us` (grup).

### 1. Teks

```js
await conn.sendText(jid, 'Halo, ini pesan teks biasa.')
```

### 2. Tombol — `conn.sendButtons`

```js
await conn.sendButtons(jid, 'Pilih salah satu:', [
    { type: 'quick', label: 'Ya', id: 'yes' },                 // balasan cepat
    { type: 'url',   label: 'Buka web', url: 'https://example.com' },
    { type: 'copy',  label: 'Salin kode', code: 'ABC123' },
    { type: 'call',  label: 'Telepon', phone: '6281234567890' },
    { type: 'list',  label: 'Lihat menu', sections: [
        { title: 'Menu', rows: [{ title: 'Nasi Goreng', id: 'nasi' }] }
    ]},
])
// Bentuk singkat: string = tombol quick reply
await conn.sendButtons(jid, 'Setuju?', ['Ya', 'Tidak'])
```

Builder:

```js
await new Button(conn, 'Pilih:')
    .addQuick('yes', 'Ya')
    .addUrl('Buka web', 'https://example.com')
    .addCopy('Salin kode', 'ABC123')
    .addCall('Telepon', '6281234567890')
    .addList('Lihat menu', [{ title: 'Menu', rows: [{ title: 'A', id: 'a' }] }])
    .send(jid)
```

### 3. List — `conn.sendList`

```js
await conn.sendList(jid, 'Pilih menu:', 'Lihat menu', [
    { title: 'Makanan', rows: [
        { title: 'Nasi Goreng', description: 'Pedas, Rp15rb', id: 'nasi' },
        { title: 'Mie Ayam',    description: 'Rp12rb',        id: 'mie' },
    ]},
    { title: 'Minuman', rows: [
        { title: 'Es Teh', id: 'teh' },
    ]},
])
```

### 4. Carousel — `conn.sendCarousel`

```js
await conn.sendCarousel(jid, [
    { title: 'Kartu 1', body: 'Deskripsi kartu pertama',
      buttons: [{ type: 'quick', label: 'Beli', id: 'beli-1' }] },
    { title: 'Kartu 2', body: 'Deskripsi kartu kedua',
      buttons: [{ type: 'url', label: 'Detail', url: 'https://example.com/2' }] },
])
```

Builder:

```js
await new Carousel(conn)
    .addCard({ title: 'Kartu 1', body: 'Isi kartu', buttons: [{ type: 'quick', label: 'OK', id: 'ok' }] })
    .addCard({ title: 'Kartu 2', body: 'Isi kartu 2' })
    .send(jid)
```

### 5. AI Rich Response — `conn.sendAIRich`

Untuk objek `richResponse` mentah (format Meta AI):

```js
await conn.sendAIRich(jid, {
    submessages: [ /* ... */ ],
})
// atau lewat builder:
await new AIRich(conn).setResponse(richResponseObject).send(jid)
```

### 6. Rich lengkap — `conn.sendRich`

Satu pintu untuk semua jenis konten rich. Terima objek flat **atau**
array `richResponse` (urutan sesuai array):

```js
await conn.sendRich(jid, {
    contentText: 'Halo, ini ringkasan:',
    richHtml: '<h1>Judul</h1><p>Isi <b>tebal</b></p>',
    code: "console.log('halo')",
    language: 'javascript',
    table: { title: 'Harga', headers: ['Barang', 'Harga'], rows: [['Kopi', '10rb']] },
    tip: 'Tip: balas pesan ini untuk lanjut',
    suggest: ['Lihat menu', 'Bantuan'],
    source: [{ title: 'Sumber', url: 'https://example.com' }],
})
```

Field yang dikenali: `contentText`, `richHtml`, `code` (+`language`),
`table` (+`title`, `noHeading`), `richImage`, `richVideo`, `reels`,
`richProduct`, `richPost`, `tip`, `suggest`, `source`, `metadata`,
`widget`, `footerAction`, `richCard`, `map`, `latex`, `gridImage`,
`inlineImage`, `links`, `headerText`, `footerText`, `disclaimerText`.

Builder `Rich` (fluent, semua tipe):

```js
await new Rich(conn)
    .addText('Halo, ini ringkasan:')
    .addHtml('<h1>Judul</h1><p>Isi <b>tebal</b></p>')
    .addCode('javascript', "console.log('halo')")
    .addTable({ title: 'Harga', headers: ['Barang', 'Harga'], rows: [['Kopi', '10rb']] })
    .addTip('Tip: balas pesan ini untuk lanjut')
    .addSuggest(['Lihat menu', 'Bantuan'])
    .send(jid)
```

### 7. Tabel — `conn.sendTable`

```js
await conn.sendTable(jid, 'Harga', ['Barang', 'Harga'], [
    ['Kopi', '10rb'],
    ['Teh',  '5rb'],
])
```

### 8. Blok kode — `conn.sendCode`

```js
await conn.sendCode(jid, "console.log('halo')", { language: 'javascript' })
// bahasa lain: 'python', 'java', 'php', 'go', 'rust', 'cpp', 'sql', 'bash', ...
```

### 9. HTML — `conn.sendHtml`

WhatsApp tidak merender HTML biasa — yang dikirim adalah kartu AI Rich
dengan primitif HTML Meta AI (`GenAIaeacdsnwHtmlPrimitive`), yang tampil
sebagai WebView tepercaya di klien:

```js
await conn.sendHtml(jid, '<h1>Menu Hari Ini</h1><p>Harga <b>mulai 10rb</b></p>')
// varian dengan judul layar:
await conn.sendHtml(jid, '<h1>Katalog</h1><p>...</p>', { title: 'Katalog' })
```

> [!NOTE]
> `TERKIRIM` = server WhatsApp menerima pesan, **bukan** bukti kartu/tombol
> tampil di layar penerima. Selalu cek visual di HP penerima untuk
> tombol, list, carousel, dan HTML.

### 10. Pesan biasa lainnya

Semua `sendMessage` standar Baileys tetap jalan seperti biasa:

```js
await conn.sendMessage(jid, { text: 'Halo' })
await conn.sendMessage(jid, { image: { url: 'https://example.com/a.jpg' }, caption: 'Foto' })
await conn.sendMessage(jid, { document: { url: 'https://example.com/f.pdf' }, fileName: 'f.pdf', mimetype: 'application/pdf' })
await conn.sendMessage(jid, { audio: { url: 'https://example.com/a.mp3' }, mimetype: 'audio/mp4', ptt: true })
await conn.sendMessage(jid, { sticker: { url: 'https://example.com/s.webp' } })
await conn.sendMessage(jid, { location: { degreesLatitude: -6.2, degreesLongitude: 106.8 } })
await conn.sendMessage(jid, { poll: { name: 'Mau makan apa?', values: ['Nasi', 'Mie'], selectableCount: 1 } })
await conn.sendMessage(jid, { react: { text: '❤️', key: msg.key } })
await conn.sendMessage(jid, { delete: msg.key })
```

## Apa yang beda dari Baileys resmi?

| Fitur | Baileys resmi (rc14) | gwejh 1.0.6 |
|---|---|---|
| `conn.sendText / sendButtons / sendList / sendCarousel` | — | ✅ |
| `conn.sendAIRich / sendRich / sendTable / sendCode / sendHtml` | — | ✅ |
| Builder `Button / Carousel / AIRich / Rich` | — | ✅ |
| Tombol legacy & native-flow, carousel, biz_bot | — | ✅ (patch `messages-send.js`) |
| AI Rich helpers (`buildAIRichResponseContent`) | — | ✅ (patch `Utils/messages.js`) |
| Base WA version | `1043857760` | sama (rc14) |
| Browser eksperimental Android | ✅ | ✅ |

Detail perubahan tiap versi ada di [CHANGELOG.md](./CHANGELOG.md).

## Contoh lengkap

Lihat `Example/example.ts` untuk contoh koneksi, pairing, dan pengiriman
dasar. Contoh `conn` di atas bisa langsung ditempel sesudah `connection ===
'open'`.

## Batasan yang diketahui

- **VM / server tanpa WebSocket ke `web.whatsapp.com`** tidak bisa konek
  (contoh: sebagian VPS membatasi WebSocket) — jalankan dari perangkat
  yang WebSocket-nya terbuka.
- **Tombol dalam tombol tidak dimungkinkan** dalam satu pesan: `nativeFlow` /
  `shop` / `carousel` adalah `oneof` di protobuf — hanya satu yang menang.
  Padanan terdekat: carousel (tiap kartu punya tombol sendiri) atau tombol
  list (lembar opsi).
- **Render HTML / tombol / carousel** harus dicek visual di HP penerima.

## Kredit

- Base library: [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
  (MIT) — terima kasih untuk [@pokearaujo](https://github.com/pokearaujo/multidevice),
  [@Sigalor](https://github.com/sigalor/whatsapp-web-reveng), dan
  [@Rhymen](https://github.com/Rhymen/go-whatsapp/).
- Pola AI Rich Response: [@pontalabs/baileys](https://www.npmjs.com/package/@pontalabs/baileys)
  (port file-per-file, tanpa dependensi beratnya).
- Survei fork & pola tambahan: `toxic-baileys`, `@japofc/baileys`,
  `@xayz/baileys`, `@chaeulso/baileys`, `@itsliaaa/baileys`,
  `@zervonex/baileys`, `@rexxhayanasi/elaina-baileys`, `raiden-baileys`,
  `@xbibzlibrary/whatsbibz`, `@lordeagle21/baileys`.

## Lisensi

MIT — lihat [LICENSE](./LICENSE).

## Disclaimer

Proyek ini tidak berafiliasi, tidak terkait, tidak diotorisasi, tidak
didukung oleh, atau dengan cara apa pun resmi terhubung dengan WhatsApp atau
anak perusahaan maupun afiliasinya. Situs resmi WhatsApp ada di whatsapp.com.
"WhatsApp" beserta nama, merek, lambang, dan gambar terkait adalah merek
dagang terdaftar dari pemiliknya masing-masing.

Maintainer proyek ini tidak dengan cara apa pun membenarkan penggunaan
aplikasi ini dalam praktik yang melanggar Terms of Service WhatsApp.
Maintainer menyerukan tanggung jawab pribadi para pengguna untuk memakai
aplikasi ini secara wajar, sebagaimana mestinya. Gunakan atas kebijaksanaan
Anda sendiri. Jangan spam orang lain. Kami melarang penggunaan untuk
stalkerware, pesan massal, atau otomatisasi yang mengganggu.
