# Changelog baileys-gwejh

## 1.0.8 — 2026-11-08
- Ralat aturan label AI (`biz_bot`, messages-send.js): node `biz_bot`
  KEMBALI nyala di semua pesan private, termasuk tombol/list/carousel —
  tombol/carousel butuh node ini supaya tampil di klien (1.0.7 sempat
  mematikannya di pesan interaktif, itu keliru). Grup tetap mati.
  Catatan: di Baileys ini label "AI" yang kelihatan di chat nempel di node
  yang sama, jadi tidak ada saklar label terpisah dari node-nya.

## 1.0.7 — 2026-11-08
- Perbaikan label AI (`biz_bot`, messages-send.js): label nyala secara
  default di chat private (`s.whatsapp.net`/`lid`), mati di grup, dan
  mati juga di pesan interaktif (tombol legacy/native-flow, list,
  carousel, template, poll) — label yang nyala bikin tombol tidak tampil
  di klien. `bizBot: false` di options mematikan label secara eksplisit.

## 1.0.6 — 2026-11-08
- Base upstream naik: 7.0.0-rc12 -> **7.0.0-rc14** (versi WA 1035194821 ->
  1043857760; opsi browser Android eksperimental; perbaikan TC token
  foto profil; perbaikan decode pesan dari diri sendiri).
- Patch gwejh dipertahankan utuh (messages-send.js): tombol legacy,
  tombol native-flow, carousel, AI rich response, node biz_bot.
- Baru — Conn helpers ala Ponta (lib/Utils/conn-helpers.js, tanpa
  dependensi berat sharp/ffmpeg):
  `conn.sendText`, `conn.sendButtons`, `conn.sendList`,
  `conn.sendCarousel`, `conn.sendAIRich`, plus builder
  `Button` / `Carousel` / `AIRich` dengan `.send(jid)`.
  Semua helper hanya membangun content lalu memanggil
  `conn.sendMessage` — tidak ada lagi `generateWAMessage` /
  `relayMessage` manual di kode bot.
- TIDAK di-port dari Ponta (alasan): `make-in-memory-store` butuh
  `@adiwajshing/keyed-db` yang tidak ada di dependensi v7;
  `mbuilder` penuh butuh `sharp` + `fluent-ffmpeg` (native, berat
  di HP). Fungsinya yang dipakai bot (kirim tombol/carousel/AI rich
  satu baris) sudah dicakup Conn helpers di atas.

- Baru — AI Rich Response penuh, port dari @pontalabs/baileys 1.2.9
  (lib/Utils/rich-helpers.js + lib/Types/RichType.js, tanpa dependensi
  berat): `conn.sendRich`, `conn.sendTable`, `conn.sendCode`,
  `conn.sendHtml`, plus builder `Rich` (fluent, semua tipe rich).
  Link tanpa URL valid dilewati + warning (bukan diganti link donasi
  Ponta). Tidak di-port: generateLatexImageContent (butuh uploadFn +
  render eksternal), make-in-memory-store, mbuilder penuh.
- README.md ditulis ulang untuk gwejh: author RFL-KSPULLX.null,
  maintainer/docs Eriri Kazumi; install + semua fitur dengan contoh
  panggilannya.

- ID pesan mirip HP (perintah Andika 2026-11-08): `generateMessageIDV2` /
  `generateMessageID` tidak lagi memakai prefix `3EB0` — kini 32 hex acak
  seperti ID dari WhatsApp asli. Banyak bot (termasuk bot official)
  mengabaikan pesan ber-ID `3EB0...` karena dianggap dari web/bot; dengan
  ID baru, pesan bot kita diperlakukan seperti pesan WA asli.

## 1.0.5 — 2026-06-08
- Base upstream 7.0.0-rc12 + patch tombol/carousel/AI rich/biz_bot.
