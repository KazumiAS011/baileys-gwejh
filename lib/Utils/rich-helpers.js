/**
 * rich-helpers — gwejh 1.0.6 (port dari @pontalabs/baileys 1.2.9).
 *
 * Isi: builder submessage AI Rich Response (teks, kode, tabel, gambar,
 * video, reels, produk, post, tip, saran, metadata, widget, footer,
 * kartu, peta, LaTeX, dan HTML — HTML dirender WhatsApp sebagai
 * WebView tepercaya) + prepareRichResponseMessage + generator
 * mandiri (generateTableContent / generateCodeBlockContent /
 * generateLinkContent / generateLatexContent) + class Rich.
 *
 * Pemakaian lewat conn (tanpa relay/generateWAMessage manual):
 *   await conn.sendRich(jid, { contentText: 'Halo', richHtml: '<b>Hi</b>' })
 *   await conn.sendTable(jid, 'Harga', ['Barang','Harga'], [['Kopi','10rb']])
 *   await conn.sendCode(jid, "console.log('hi')", { language: 'javascript' })
 *   await conn.sendHtml(jid, '<h1>Judul</h1><p>Isi</p>')
 *   await new Rich(conn).addText('Halo').addHtml('<b>tebal</b>').addCode('js', 'let a = 1').send(jid)
 *
 * Semua pengiriman menghasilkan botForwardedMessage yang ditangani
 * patch messages-send.js gwejh (buildAIRichRawContentForSend).
 * TIDAK butuh sharp/ffmpeg: gambar/video di sini berbasis URL.
 */
import { getRandomValues, randomUUID, randomBytes } from 'crypto';
import { proto } from '../../WAProto/index.js';
import { generateMessageIDV2 } from './generics.js';
import { CodeHighlightType, RichSubMessageType } from '../Types/RichType.js';

// LEXER_REGEX + LANGUAGE_KEYWORDS: di Ponta tinggal di Defaults /
const LEXER_REGEX = /(\/\/.*|\/\*[\s\S]*?\*\/|#.*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[\s\S]*?`)|(\b[a-zA-Z_]\w*\b)(?=\s*\()|(\b[a-zA-Z_]\w*\b)|(\b\d+(?:\.\d+)?\b)|(\s+|[^\w\s]+)/g;
const LANGUAGE_KEYWORDS = {
    javascript: new Set(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','class','extends','new','this','typeof','instanceof','in','of','try','catch','finally','throw','async','await','import','export','from','default','true','false','null','undefined','void','delete','yield','static','get','set','super']),
    js: null, typescript: null, ts: null,
    python: new Set(['def','class','return','if','elif','else','for','while','try','except','finally','with','as','import','from','pass','break','continue','lambda','True','False','None','and','or','not','in','is','global','nonlocal','assert','del','raise','yield','async','await']),
    py: null,
    java: new Set(['public','private','protected','class','interface','extends','implements','static','final','void','int','long','double','float','boolean','char','byte','short','new','return','if','else','for','while','do','switch','case','break','continue','try','catch','finally','throw','throws','this','super','import','package','true','false','null','abstract','synchronized','volatile']),
    php: new Set(['function','class','public','private','protected','static','return','if','else','elseif','for','foreach','while','do','switch','case','break','continue','try','catch','finally','throw','new','echo','true','false','null','extends','implements','namespace','use','as','const']),
    go: new Set(['func','package','import','var','const','type','struct','interface','map','chan','go','defer','return','if','else','for','range','switch','case','break','continue','fallthrough','select','true','false','nil']),
    golang: null,
    rust: new Set(['fn','let','mut','const','static','struct','enum','impl','trait','pub','use','mod','crate','return','if','else','for','while','loop','match','break','continue','true','false','Some','None','Ok','Err','self','Self','super','in','ref','move','async','await']),
    rs: null,
    cpp: new Set(['int','char','float','double','void','bool','class','struct','public','private','protected','virtual','template','typename','namespace','using','return','if','else','for','while','do','switch','case','break','continue','new','delete','this','true','false','nullptr','const','static','inline','extern','typedef','enum','union']),
    'c++': null,
    html: new Set(['div','span','p','a','img','html','head','body','script','style','table','form','input','button','ul','li','h1','h2','h3']),
    css: new Set(['color','background','margin','padding','display','position','font','border','width','height']),
    sql: new Set(['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','DROP','JOIN','ON','AS','AND','OR','NOT','NULL','ORDER','BY','GROUP','LIMIT']),
    bash: new Set(['if','then','else','elif','fi','for','while','do','done','in','function','echo','exit','return','export','true','false']),
};
LANGUAGE_KEYWORDS.js = LANGUAGE_KEYWORDS.javascript;
LANGUAGE_KEYWORDS.typescript = LANGUAGE_KEYWORDS.javascript;
LANGUAGE_KEYWORDS.ts = LANGUAGE_KEYWORDS.javascript;
LANGUAGE_KEYWORDS.py = LANGUAGE_KEYWORDS.python;
LANGUAGE_KEYWORDS.golang = LANGUAGE_KEYWORDS.go;
LANGUAGE_KEYWORDS.rs = LANGUAGE_KEYWORDS.rust;
LANGUAGE_KEYWORDS['c++'] = LANGUAGE_KEYWORDS.cpp;

const NOOP = new Set([]);

/* ─────────────────────────────────────────────────────────────
   LATEX URL GENERATOR
   WhatsApp client membutuhkan URL gambar render untuk setiap
   LaTeX expression. Tanpa URL, pesan tampil kosong.
   Gunakan latex.codecogs.com sebagai fallback gratis~
───────────────────────────────────────────────────────────── */
const buildLatexUrl = (expression) => {
    if (!expression) return null;
    const encoded = encodeURIComponent(expression);
    return `https://latex.codecogs.com/png.image?\dpi{150}\bg{white}${encoded}`;
};

/* ─────────────────────────────────────────────────────────────
   IMAGE URL HELPER
   Konversi objek AIRichResponseImageURL ke snake_case JSON
   agar WA client bisa baca dengan benar~
───────────────────────────────────────────────────────────── */
const toImageUrlJson = (imgUrl) => {
    if (!imgUrl) return null;
    // support both plain string and object
    if (typeof imgUrl === 'string') return { image_preview_url: imgUrl, image_high_res_url: imgUrl, source_url: null };
    return {
        image_preview_url: imgUrl.imagePreviewUrl || imgUrl.image_preview_url || null,
        image_high_res_url: imgUrl.imageHighResUrl || imgUrl.image_high_res_url || null,
        source_url: imgUrl.sourceUrl || imgUrl.source_url || null
    };
};

/* ─────────────────────────────────────────────────────────────
   TOKENIZER
───────────────────────────────────────────────────────────── */

export const tokenizeCode = (code, language = 'javascript') => {
    const keywords = LANGUAGE_KEYWORDS[language] || NOOP;
    const blocks = [];
    LEXER_REGEX.lastIndex = 0;
    let match;
    while ((match = LEXER_REGEX.exec(code)) !== null) {
        if (match[1]) {
            blocks.push({ highlightType: CodeHighlightType.COMMENT, codeContent: match[1] });
        } else if (match[2]) {
            blocks.push({ highlightType: CodeHighlightType.STRING, codeContent: match[2] });
        } else if (match[3]) {
            blocks.push({
                highlightType: keywords.has(match[3]) ? CodeHighlightType.KEYWORD : CodeHighlightType.METHOD,
                codeContent: match[3],
            });
        } else if (match[4]) {
            blocks.push({
                highlightType: keywords.has(match[4]) ? CodeHighlightType.KEYWORD : CodeHighlightType.DEFAULT,
                codeContent: match[4],
            });
        } else if (match[5]) {
            blocks.push({ highlightType: CodeHighlightType.NUMBER, codeContent: match[5] });
        } else {
            blocks.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: match[6] });
        }
    }
    return blocks;
};

/* ─────────────────────────────────────────────────────────────
   INCOMING DECODER — parse rich message yang diterima
───────────────────────────────────────────────────────────── */

/**
 * Parse sebuah AIRichResponseSubMessage proto menjadi object JS yang mudah dipakai.
 * Return null kalau tipe tidak dikenal.
 */
export const parseRichSubMessage = (submessage) => {
    if (!submessage) return null;
    const type = submessage.messageType;

    switch (type) {
        case RichSubMessageType.TEXT:
            return {
                type: 'text',
                text: submessage.messageText || '',
            };

        case RichSubMessageType.CODE:
            return {
                type: 'code',
                language: submessage.codeMetadata?.codeLanguage || 'plain',
                blocks: (submessage.codeMetadata?.codeBlocks || []).map(b => ({
                    highlight: CodeHighlightType[b.highlightType] ?? 'DEFAULT',
                    content: b.codeContent || '',
                })),
                /** Helper: ambil source code mentah tanpa highlight info */
                get raw() {
                    return this.blocks.map(b => b.content).join('');
                },
            };

        case RichSubMessageType.TABLE:
            return {
                type: 'table',
                title: submessage.tableMetadata?.title || '',
                rows: (submessage.tableMetadata?.rows || []).map(row => ({
                    isHeading: row.isHeading ?? false,
                    items: row.items || [],
                })),
            };

        case RichSubMessageType.GRID_IMAGE:
            return {
                type: 'gridImage',
                gridImageUrl: submessage.gridImageMetadata?.gridImageUrl || null,
                imageUrls: submessage.gridImageMetadata?.imageUrls || [],
            };

        case RichSubMessageType.INLINE_IMAGE:
            return {
                type: 'inlineImage',
                imageUrl: submessage.imageMetadata?.imageUrl || null,
                imageText: submessage.imageMetadata?.imageText || '',
                alignment: submessage.imageMetadata?.alignment ?? 0,
                tapLinkUrl: submessage.imageMetadata?.tapLinkUrl || null,
            };

        case RichSubMessageType.DYNAMIC:
            return {
                type: 'dynamic',
                dynamicType: submessage.dynamicMetadata?.type ?? 0,
                version: submessage.dynamicMetadata?.version ?? 0,
                url: submessage.dynamicMetadata?.url || null,
                loopCount: submessage.dynamicMetadata?.loopCount ?? 0,
            };

        case RichSubMessageType.MAP:
            return {
                type: 'map',
                centerLatitude: submessage.mapMetadata?.centerLatitude ?? 0,
                centerLongitude: submessage.mapMetadata?.centerLongitude ?? 0,
                latitudeDelta: submessage.mapMetadata?.latitudeDelta ?? 0,
                longitudeDelta: submessage.mapMetadata?.longitudeDelta ?? 0,
                showInfoList: submessage.mapMetadata?.showInfoList ?? false,
                annotations: (submessage.mapMetadata?.annotations || []).map(a => ({
                    number: a.annotationNumber ?? 0,
                    latitude: a.latitude ?? 0,
                    longitude: a.longitude ?? 0,
                    title: a.title || '',
                    body: a.body || '',
                })),
            };

        case RichSubMessageType.LATEX:
            return {
                type: 'latex',
                text: submessage.latexMetadata?.text || '',
                expressions: (submessage.latexMetadata?.expressions || []).map(e => ({
                    expression: e.latexExpression || '',
                    url: e.url || null,
                    width: e.width ?? 0,
                    height: e.height ?? 0,
                })),
            };

        case RichSubMessageType.CONTENT_ITEMS:
            return {
                type: 'contentItems',
                contentType: submessage.contentItemsMetadata?.contentType ?? 0,
                items: (submessage.contentItemsMetadata?.itemsMetadata || []).map(item => {
                    if (item.reelItem) {
                        return {
                            kind: 'reel',
                            title: item.reelItem.title || '',
                            profileIconUrl: item.reelItem.profileIconUrl || null,
                            thumbnailUrl: item.reelItem.thumbnailUrl || null,
                            videoUrl: item.reelItem.videoUrl || null,
                        };
                    }
                    return { kind: 'unknown' };
                }),
            };

        default:
            return { type: 'unknown', raw: submessage };
    }
};

/**
 * Parse seluruh AIRichResponseMessage menjadi array parsed submessages.
 * Bisa dipanggil langsung dari handler messages.upsert:
 *
 *   const inner = normalizeMessageContent(msg.message)
 *   const parsed = parseRichMessage(inner?.richResponseMessage)
 */
export const parseRichMessage = (richResponseMessage) => {
    if (!richResponseMessage) return null;

    const submessages = (richResponseMessage.submessages || [])
        .map(parseRichSubMessage)
        .filter(Boolean);

    let unifiedData = null;
    if (richResponseMessage.unifiedResponse?.data) {
        try {
            const buf = richResponseMessage.unifiedResponse.data;
            unifiedData = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf-8') : Buffer.from(buf).toString('utf-8'));
        } catch (_) { /* ignore parse error */ }
    }

    return {
        messageType: richResponseMessage.messageType ?? 0,
        submessages,
        unifiedData,
    };
};

/* ─────────────────────────────────────────────────────────────
   OUTGOING BUILDER — unified response JSON per subtype
───────────────────────────────────────────────────────────── */

const buildUnifiedSection = (submessage) => {
    switch (submessage.messageType) {
        case RichSubMessageType.TEXT:
            return {
                view_model: {
                    primitive: {
                        text: submessage.messageText,
                        inline_entities: submessage.inlineEntities || [],
                        __typename: 'GenAIMarkdownTextUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };

        case RichSubMessageType.CODE: {
            const cm = submessage.codeMetadata;
            return {
                view_model: {
                    primitive: {
                        language: cm.codeLanguage,
                        code_blocks: cm.codeBlocks.map(b => ({
                            content: b.codeContent,
                            type: CodeHighlightType[b.highlightType]
                        })),
                        __typename: 'GenAICodeUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.TABLE: {
            const tm = submessage.tableMetadata;
            return {
                view_model: {
                    primitive: {
                        title: tm.title,
                        rows: tm.rows.map(row => ({
                            is_header: row.isHeading,
                            cells: row.items,
                            markdown_cells: row.items.map(item => ({ text: item }))
                        })),
                        __typename: 'GenATableUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.GRID_IMAGE: {
            const gm = submessage.gridImageMetadata;
            return {
                view_model: {
                    primitive: {
                        grid_image_url: toImageUrlJson(gm.gridImageUrl),
                        image_urls: (gm.imageUrls || []).map(toImageUrlJson),
                        __typename: 'GenAIGridImageUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.INLINE_IMAGE: {
            const im = submessage.imageMetadata;
            return {
                view_model: {
                    primitive: {
                        image_url: toImageUrlJson(im.imageUrl),
                        image_text: im.imageText,
                        alignment: im.alignment ?? 0,
                        tap_link_url: im.tapLinkUrl || null,
                        __typename: 'GenAIInlineImageUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.DYNAMIC: {
            const dm = submessage.dynamicMetadata;
            return {
                view_model: {
                    primitive: {
                        type: dm.type ?? 0,
                        version: dm.version ?? 0,
                        url: dm.url,
                        loop_count: dm.loopCount ?? 0,
                        __typename: 'GenAIDynamicUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.MAP: {
            const mm = submessage.mapMetadata;
            return {
                view_model: {
                    primitive: {
                        center_latitude: mm.centerLatitude,
                        center_longitude: mm.centerLongitude,
                        latitude_delta: mm.latitudeDelta,
                        longitude_delta: mm.longitudeDelta,
                        show_info_list: mm.showInfoList ?? false,
                        annotations: (mm.annotations || []).map(a => ({
                            annotation_number: a.annotationNumber,
                            latitude: a.latitude,
                            longitude: a.longitude,
                            title: a.title,
                            body: a.body
                        })),
                        __typename: 'GenAIMapUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.LATEX: {
            const lm = submessage.latexMetadata;
            return {
                view_model: {
                    primitive: {
                        text: lm.text,
                        expressions: (lm.expressions || []).map(e => ({
                            latex_expression: e.latexExpression,
                            url: e.url,
                            width: e.width,
                            height: e.height,
                            font_height: e.fontHeight,
                            image_top_padding: e.imageTopPadding,
                            image_leading_padding: e.imageLeadingPadding,
                            image_bottom_padding: e.imageBottomPadding,
                            image_trailing_padding: e.imageTrailingPadding
                        })),
                        __typename: 'GenAILatexUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        case RichSubMessageType.CONTENT_ITEMS: {
            const ci = submessage.contentItemsMetadata;
            return {
                view_model: {
                    primitive: {
                        content_type: ci.contentType ?? 0,
                        items_metadata: (ci.itemsMetadata || []).map(item => {
                            if (item.reelItem) {
                                return {
                                    reel_item: {
                                        title: item.reelItem.title,
                                        profile_icon_url: item.reelItem.profileIconUrl,
                                        thumbnail_url: item.reelItem.thumbnailUrl,
                                        video_url: item.reelItem.videoUrl
                                    }
                                };
                            }
                            return {};
                        }),
                        __typename: 'GenAIContentItemsUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        }

        default:
            return submessage;
    }
};

export const toUnified = (submessages) => ({
    response_id: randomUUID(),
    sections: submessages.map(buildUnifiedSection)
});

/* ─────────────────────────────────────────────────────────────
   PREPARE HELPERS — builder per tipe submessage
───────────────────────────────────────────────────────────── */

/** Buat submessage TEXT */
const makeTextSub = (text, inlineEntities) => ({
    messageType: RichSubMessageType.TEXT,
    messageText: text,
    ...(inlineEntities ? { inlineEntities } : {})
});

/** Buat submessage CODE dengan auto-tokenize */
const makeCodeSub = (code, language = 'javascript') => ({
    messageType: RichSubMessageType.CODE,
    codeMetadata: {
        codeLanguage: language,
        codeBlocks: tokenizeCode(code, language)
    }
});

/** Buat submessage TABLE */
const makeTableSub = (rows, title, noHeading) => ({
    messageType: RichSubMessageType.TABLE,
    tableMetadata: {
        title: title || '',
        rows: rows.map((items, i) => ({
            isHeading: !noHeading && i === 0,
            items
        }))
    }
});

/** Normalize input ke format AIRichResponseImageURL */
const normalizeImageUrl = (u) => {
    if (!u) return null;
    if (typeof u === 'string') return { imagePreviewUrl: u, imageHighResUrl: u, sourceUrl: null };
    return {
        imagePreviewUrl: u.imagePreviewUrl || u.image_preview_url || null,
        imageHighResUrl: u.imageHighResUrl || u.image_high_res_url || null,
        sourceUrl: u.sourceUrl || u.source_url || null
    };
};

/** Buat submessage GRID_IMAGE */
const makeGridImageSub = (gridImageUrl, imageUrls = []) => ({
    messageType: RichSubMessageType.GRID_IMAGE,
    gridImageMetadata: {
        gridImageUrl: normalizeImageUrl(gridImageUrl),
        imageUrls: (imageUrls || []).map(normalizeImageUrl)
    }
});

/** Buat submessage INLINE_IMAGE */
const makeInlineImageSub = (imageUrl, imageText = '', alignment = 0, tapLinkUrl = null) => ({
    messageType: RichSubMessageType.INLINE_IMAGE,
    imageMetadata: {
        imageUrl: normalizeImageUrl(imageUrl),
        imageText,
        alignment,
        tapLinkUrl
    }
});

/** Buat submessage DYNAMIC (animated image/GIF) */
const makeDynamicSub = (url, dynamicType = 1, version = 1, loopCount = 0) => ({
    messageType: RichSubMessageType.DYNAMIC,
    dynamicMetadata: { type: dynamicType, version, url, loopCount }
});

/** Buat submessage MAP */
const makeMapSub = (centerLatitude, centerLongitude, options = {}) => ({
    messageType: RichSubMessageType.MAP,
    mapMetadata: {
        centerLatitude,
        centerLongitude,
        latitudeDelta: options.latitudeDelta ?? 0.05,
        longitudeDelta: options.longitudeDelta ?? 0.05,
        showInfoList: options.showInfoList ?? false,
        annotations: (options.annotations || []).map((a, i) => ({
            annotationNumber: a.number ?? i + 1,
            latitude: a.latitude,
            longitude: a.longitude,
            title: a.title || '',
            body: a.body || ''
        }))
    }
});

/** Buat submessage LATEX */
const makeLatexSub = (text, expressions = []) => ({
    messageType: RichSubMessageType.LATEX,
    latexMetadata: {
        text,
        expressions: expressions.map(e => {
            const expr = e.expression || e.latexExpression || '';
            // url WAJIB ada agar WA client bisa render — auto-generate jika tidak disupply
            const url = e.url || buildLatexUrl(expr);
            return {
                latexExpression: expr,
                url,
                width: e.width ?? 120,
                height: e.height ?? 40,
                fontHeight: e.fontHeight ?? 0,
                imageTopPadding: e.imageTopPadding ?? 0,
                imageLeadingPadding: e.imageLeadingPadding ?? 0,
                imageBottomPadding: e.imageBottomPadding ?? 0,
                imageTrailingPadding: e.imageTrailingPadding ?? 0
            };
        })
    }
});

/** Buat submessage CONTENT_ITEMS (carousel reel) */
const makeContentItemsSub = (items, contentType = 0) => ({
    messageType: RichSubMessageType.CONTENT_ITEMS,
    contentItemsMetadata: {
        contentType,
        itemsMetadata: items.map(item => {
            if (item.reelItem || item.kind === 'reel') {
                const r = item.reelItem || item;
                return {
                    reelItem: {
                        title: r.title || '',
                        profileIconUrl: r.profileIconUrl || null,
                        thumbnailUrl: r.thumbnailUrl || null,
                        videoUrl: r.videoUrl || null
                    }
                };
            }
            return {};
        })
    }
});

/** Buat section SOURCE (search result links) — hanya unified, tidak ada submessage proto */
const makeSourceSection = (sources = []) => {
    const list = Array.isArray(sources) ? sources : [sources];
    return {
        view_model: {
            primitive: {
                sources: list.map(s => ({
                    source_url: s.url ?? s.source_url ?? '',
                    source_title: s.title ?? s.source_title ?? '',
                    source_display_name: s.display_name ?? s.displayName ?? s.title ?? '',
                    source_subtitle: s.subtitle ?? s.source_subtitle ?? '',
                    source_type: s.source_type ?? 'THIRD_PARTY',
                    favicon: {
                        url: s.favicon ?? s.faviconCDNURL ?? '',
                        width: 16,
                        height: 16
                    }
                })),
                __typename: 'GenAISearchResultPrimitive'
            },
            __typename: 'GenAISingleLayoutViewModel'
        }
    };
};

/** Buat submessage + unified section untuk IMAGE (grid image style) */
const makeImageSub = (imageUrl) => {
    const urls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
    const imageUrls = urls.map(u => ({
        imagePreviewUrl: u,
        imageHighResUrl: u,
        sourceUrl: null
    }));
    return {
        sub: {
            messageType: RichSubMessageType.GRID_IMAGE,
            gridImageMetadata: {
                gridImageUrl: normalizeImageUrl(urls[0]),
                imageUrls: imageUrls.map(normalizeImageUrl)
            }
        },
        sections: imageUrls.map(({ imagePreviewUrl }) => ({
            view_model: {
                primitive: {
                    media: { url: imagePreviewUrl, mime_type: 'image/png' },
                    imagine_type: 'IMAGE',
                    status: { status: 'READY' },
                    __typename: 'GenAIImaginePrimitive'
                },
                __typename: 'GenAISingleLayoutViewModel'
            }
        }))
    };
};

/** Buat submessage + unified section untuk VIDEO */
const makeVideoSub = (videoUrl) => {
    const urls = Array.isArray(videoUrl) ? videoUrl : [videoUrl];
    const parsed = urls.map(item => {
        const [url, duration = '0'] = item.split('|');
        return { url, duration: Number(duration) || 0 };
    });
    return {
        sub: {
            messageType: RichSubMessageType.DYNAMIC,
            dynamicMetadata: {
                type: 1,
                version: 1,
                url: parsed[0]?.url || '',
                loopCount: 0
            }
        },
        sections: parsed.map(({ url, duration }) => ({
            view_model: {
                primitive: {
                    media: { url, mime_type: 'video/mp4', duration },
                    imagine_type: 'ANIMATE',
                    status: { status: 'READY' },
                    __typename: 'GenAIImaginePrimitive'
                },
                __typename: 'GenAISingleLayoutViewModel'
            }
        }))
    };
};

/** Buat submessage + unified section untuk REELS (HScroll) */
const makeReelsSub = (reelsItems = []) => {
    const list = Array.isArray(reelsItems) ? reelsItems : [reelsItems];
    return {
        sub: {
            messageType: RichSubMessageType.CONTENT_ITEMS,
            contentItemsMetadata: {
                contentType: 1,
                itemsMetadata: list.map(item => ({
                    reelItem: {
                        title: item.username ?? item.title ?? '',
                        profileIconUrl: item.profileIconUrl ?? item.profile_url ?? null,
                        thumbnailUrl: item.thumbnailUrl ?? item.thumbnail ?? null,
                        videoUrl: item.videoUrl ?? item.url ?? null
                    }
                }))
            }
        },
        section: {
            view_model: {
                primitives: list.map(item => ({
                    reels_url: item.videoUrl ?? item.url ?? '',
                    thumbnail_url: item.thumbnailUrl ?? item.thumbnail ?? '',
                    creator: item.username ?? item.title ?? '',
                    avatar_url: item.profileIconUrl ?? item.profile_url ?? '',
                    reels_title: item.reels_title ?? item.title ?? '',
                    likes_count: item.likes_count ?? item.like ?? 0,
                    shares_count: item.shares_count ?? item.share ?? 0,
                    view_count: item.view_count ?? item.view ?? 0,
                    reel_source: item.reel_source ?? item.source ?? 'IG',
                    is_verified: !!(item.is_verified || item.verified),
                    __typename: 'GenAIReelPrimitive'
                })),
                __typename: 'GenAIHScrollLayoutViewModel'
            }
        }
    };
};

/** Buat unified section untuk PRODUCT (single: Single layout, array: HScroll) */
const makeProductSection = (data) => {
    const items = Array.isArray(data) ? data : [data];
    const primitives = items.map(item => ({
        title: item.title ?? '',
        brand: item.brand ?? '',
        price: item.price ?? '',
        sale_price: item.sale_price ?? item.salePrice ?? '',
        product_url: (() => {
            const u = item.product_url ?? item.url ?? '';
            if (!u || !/^https?:\/\//i.test(u)) {
                console.warn('[baileys] richProduct: product_url/url kosong atau tidak diawali http(s):// — tautan produk ini kemungkinan besar tidak akan bisa dibuka di WhatsApp. Nilai yang diterima:', u || '(kosong)');
            }
            return u;
        })(),
        image: { url: item.image_url ?? item.image ?? '' },
        additional_images: [{ url: item.icon_url ?? item.icon ?? '' }],
        __typename: 'GenAIProductItemCardPrimitive'
    }));
    const isMultiple = Array.isArray(data);
    return {
        sub: {
            messageType: RichSubMessageType.TEXT,
            messageText: ''
        },
        section: isMultiple
            ? {
                view_model: {
                    primitives,
                    __typename: 'GenAIHScrollLayoutViewModel'
                }
            }
            : {
                view_model: {
                    primitive: primitives[0],
                    __typename: 'GenAISingleLayoutViewModel'
                }
            }
    };
};

/** Buat unified section untuk POST (HScroll) */
const makePostSection = (data) => {
    const posts = Array.isArray(data) ? data : [data];
    const primitives = posts.map(p => ({
        title: p.title ?? '',
        subtitle: p.subtitle ?? '',
        username: p.username ?? '',
        profile_picture_url: p.profile_picture_url ?? p.profile_url ?? '',
        is_verified: !!(p.is_verified || p.verified),
        thumbnail_url: p.thumbnail_url ?? p.thumbnail ?? '',
        post_caption: p.post_caption ?? p.caption ?? '',
        likes_count: p.likes_count ?? p.like ?? 0,
        comments_count: p.comments_count ?? p.comment ?? 0,
        shares_count: p.shares_count ?? p.share ?? 0,
        post_url: p.post_url ?? p.url ?? '',
        post_deeplink: p.post_deeplink ?? p.deeplink ?? '',
        source_app: p.source_app ?? p.source ?? 'INSTAGRAM',
        footer_label: p.footer_label ?? p.footer ?? '',
        footer_icon: p.footer_icon ?? p.icon ?? '',
        is_carousel: posts.length > 1,
        orientation: p.orientation ?? 'LANDSCAPE',
        post_type: p.post_type ?? 'VIDEO',
        __typename: 'GenAIPostPrimitive'
    }));
    return {
        sub: {
            messageType: RichSubMessageType.TEXT,
            messageText: ''
        },
        section: {
            view_model: {
                primitives,
                __typename: 'GenAIHScrollLayoutViewModel'
            }
        }
    };
};

/** Buat submessage + unified section untuk TIP (metadata text) */
const makeTipSub = (text) => ({
    sub: {
        messageType: RichSubMessageType.TEXT,
        messageText: text
    },
    section: {
        view_model: {
            primitive: {
                text,
                __typename: 'GenAIMetadataTextPrimitive'
            },
            __typename: 'GenAISingleLayoutViewModel'
        }
    }
});

/** Buat unified section untuk SUGGEST (ActionRow pill buttons) — tidak ada submessage proto */
const makeSuggestSection = (suggestion) => {
    const suggestions = Array.isArray(suggestion) ? suggestion : [suggestion];
    return {
        view_model: {
            primitives: suggestions.map(text => ({
                prompt_text: text,
                prompt_type: 'SUGGESTED_PROMPT',
                __typename: 'GenAIFollowUpSuggestionPillPrimitive'
            })),
            __typename: 'GenAIActionRowLayoutViewModel'
        }
    };
};

/** Rich AI primitives tambahan dari builder 4.7. */
const makeMetadataSub = (text, typename = 'GenAIMetadataTextPrimitive', prefix = '') => ({
    sub: { messageType: RichSubMessageType.TEXT, messageText: text },
    section: { view_model: { primitive: { text: prefix + text, __typename: typename }, __typename: 'GenAISingleLayoutViewModel' } }
});
/** Rich HTML WebView primitive. The HTML is rendered as a trusted Rich AI webview payload. */
const makeHtmlSection = (html) => {
    if (typeof html !== 'string') throw new TypeError('HTML must be a string');
    return {
        view_model: {
            primitive: {
                __typename: 'GenAIaeacdsnwHtmlPrimitive',
                payload: html,
                trusted_sources: []
            },
            __typename: 'GenAISingleLayoutViewModel'
        }
    };
};
const makeWidgetSection = (data) => {
    const items = Array.isArray(data) ? data : [data];
    const widgets = items.map(item => ({
        __typename: 'GenAI3PExtWidgetPrimitive',
        header: { __typename: 'GenAI3PExtWidgetStandardHeader', title: item?.title ?? '', ...(item?.header ?? {}) },
        body: { __typename: 'GenAI3PExtCalendarEventList', sections: item?.sections ?? [],
            ctas: (item?.actions ?? []).map(action => ({ __typename: 'GenAI3PExtWidgetCTA', label: action?.label ?? '', state: action?.state ?? 'PENDING', kind: action?.kind ?? 'OTHER', tool_call_id: action?.tool_call_id ?? action?.id ?? '', ...(action?.toast ? { toast: { __typename: 'GenAI3PExtWidgetToast', label: action.toast.label ?? action.label ?? '' } } : {}) })), ...(item?.body ?? {}) }
    }));
    return { view_model: widgets.length > 1 ? { primitives: widgets, __typename: 'GenAIHScrollLayoutViewModel' } : { primitive: widgets[0], __typename: 'GenAISingleLayoutViewModel' } };
};
const makeFooterActionSection = (data) => {
    const items = Array.isArray(data) ? data : [data];
    const actions = items.map(item => ({ __typename: 'GenAIFooterActionPrimitive', cta_text: item?.text ?? item?.cta_text ?? '', cta_type: item?.type ?? item?.cta_type ?? 'OPEN_URL', cta_url: item?.url ?? item?.cta_url ?? '' }));
    return { view_model: actions.length > 1 ? { primitives: actions, __typename: 'GenAIHScrollLayoutViewModel' } : { primitive: actions[0], __typename: 'GenAISingleLayoutViewModel' } };
};

/** Normalize input tabel: terima array 2D biasa (native ponta) ATAU
 *  shorthand README/1.1.5-style { title?, headers?, rows }. */
const normalizeTableInput = (t, fallbackTitle, fallbackNoHeading) => {
    if (t == null) {
        return { rows: [], title: fallbackTitle, noHeading: fallbackNoHeading };
    }
    if (Array.isArray(t)) {
        return { rows: t, title: fallbackTitle, noHeading: fallbackNoHeading };
    }
    if (typeof t === 'object') {
        const headers = Array.isArray(t.headers) ? t.headers : [];
        const rows = Array.isArray(t.rows) ? t.rows : [];
        return {
            rows: headers.length ? [headers, ...rows] : rows,
            title: fallbackTitle ?? t.title,
            noHeading: fallbackNoHeading ?? (headers.length === 0)
        };
    }
    return { rows: [], title: fallbackTitle, noHeading: fallbackNoHeading };
};

/** Buat unified section untuk RICH CARD / ENTITY */
const makeRichCardSection = (data) => {
    const item = data || {};
    const thumbnailUrl = item.thumbnail_url ?? item.thumbnailUrl ?? item.thumbnail ?? '';
    const profileUrl = item.profile_url ?? item.profileUrl ?? thumbnailUrl;

    return {
        view_model: {
            primitive: {
                __typename: 'GenAICompactEntityPrimitive',
                title: item.title ?? '',
                subtitle: item.subtitle ?? '',
                secondary_subtitle: item.description ?? '',
                entity_id: item.entity_id ?? item.entityId ?? '',
                entity_url: item.entity_url ?? item.entityUrl ?? '',
                entity_type: item.entity_type ?? 'PAGE',
                action_type: item.action_type ?? 'FOLLOW',
                is_verified: !!item.verification,
                image: {
                    url: thumbnailUrl,
                    url_fallback: profileUrl
                }
            },
            __typename: 'GenAISingleLayoutViewModel'
        }
    };
};

/* ─────────────────────────────────────────────────────────────
   MAIN BUILDER — prepareRichResponseMessage
───────────────────────────────────────────────────────────── */

export const prepareRichResponseMessage = (content) => {
    const {
        code, contentText, disclaimerText, footerText, headerText,
        language, links, noHeading, richResponse, table, title,
        // sub-types lama
        gridImage, inlineImage, dynamic: dynamicContent,
        map: mapContent, latex, contentItems,
        // sub-types baru (prefixed 'rich' agar tidak konflik dengan media biasa)
        richImage, richVideo, reels, source, richProduct, richPost, tip, suggest,
        richWidget, widget, richFooterAction, footerAction, richMetadata, metadata, richFOAText, foaText, richHtml, richCard,
        // opsi tambahan (belum ada di versi ponta.zip semula)
        aiForwarded
    } = content;

    const submessages = [];
    const sections = []; // submessages & sections SELALU ditambah barengan per-item, jadi urutan aslinya kejaga

    /** Tambah 1 item ke submessages+sections sekaligus (jaga urutan). */
    const push = (sub, sec) => {
        if (sub) submessages.push(...(Array.isArray(sub) ? sub : [sub]));
        if (sec) sections.push(...(Array.isArray(sec) ? sec : [sec]));
    };

    /** Proses 1 objek "sub" (dari array richResponse, atau dari field flat) jadi submessage+section. */
    const buildOne = (sub) => {
        if (sub.text != null) {
            const s = makeTextSub(sub.text, sub.inlineEntities);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.code != null) {
            const s = makeCodeSub(sub.code, sub.language || 'javascript');
            return push(s, buildUnifiedSection(s));
        }
        if (sub.table != null) {
            // terima array 2D biasa ATAU shorthand { title?, headers?, rows }
            const norm = normalizeTableInput(sub.table, sub.title, sub.noHeading);
            const s = makeTableSub(norm.rows, norm.title, norm.noHeading);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.gridImage != null) {
            const s = makeGridImageSub(sub.gridImage.gridImageUrl, sub.gridImage.imageUrls);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.inlineImage != null) {
            const s = makeInlineImageSub(sub.inlineImage.imageUrl, sub.inlineImage.imageText, sub.inlineImage.alignment, sub.inlineImage.tapLinkUrl);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.dynamic != null) {
            const s = makeDynamicSub(sub.dynamic.url, sub.dynamic.type, sub.dynamic.version, sub.dynamic.loopCount);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.map != null) {
            const s = makeMapSub(sub.map.centerLatitude, sub.map.centerLongitude, sub.map);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.latex != null) {
            const s = makeLatexSub(sub.latex.text, sub.latex.expressions);
            return push(s, buildUnifiedSection(s));
        }
        if (sub.contentItems != null) {
            const s = makeContentItemsSub(sub.contentItems.items, sub.contentItems.contentType);
            return push(s, buildUnifiedSection(s));
        }
        // ── tipe baru ──
        if (sub.richImage != null) {
            const built = makeImageSub(sub.richImage);
            return push(built.sub, built.sections);
        }
        if (sub.richVideo != null) {
            const built = makeVideoSub(sub.richVideo);
            return push(built.sub, built.sections);
        }
        if (sub.reels != null) {
            const built = makeReelsSub(sub.reels);
            return push(built.sub, built.section);
        }
        if (sub.source != null) {
            return push(null, makeSourceSection(sub.source));
        }
        if (sub.richProduct != null) {
            const built = makeProductSection(sub.richProduct);
            return push(built.sub, built.section);
        }
        if (sub.richPost != null) {
            const built = makePostSection(sub.richPost);
            return push(built.sub, built.section);
        }
        if (sub.tip != null) {
            const built = makeTipSub(sub.tip);
            return push(built.sub, built.section);
        }
        if (sub.suggest != null) {
            return push(null, makeSuggestSection(sub.suggest));
        }
        if (sub.widget != null) return push(null, makeWidgetSection(sub.widget));
        if (sub.footerAction != null) return push(null, makeFooterActionSection(sub.footerAction));
        if (sub.metadata != null) { const built = makeMetadataSub(sub.metadata); return push(built.sub, built.section); }
        if (sub.foaText != null) { const built = makeMetadataSub(sub.foaText, 'FOATextPrimitive'); return push(built.sub, built.section); }
        if (sub.richCard != null) return push(null, makeRichCardSection(sub.richCard));
        if (sub.richHtml != null) return push(null, makeHtmlSection(sub.richHtml));
        // passthrough — kalau sudah bentuk proto submessage manual
        return push(sub, buildUnifiedSection(sub));
    };

    /* ── mode array (richResponse) — multi-section campuran, urutan sesuai array ── */
    if (Array.isArray(richResponse)) {
        if (headerText) buildOne({ text: headerText });
        richResponse.forEach(buildOne);
        if (footerText) buildOne({ text: footerText });

    /* ── mode flat (convenience fields) ── */
    } else {
        if (headerText)     buildOne({ text: headerText });

        if (code)           buildOne({ code, language });
        if (table)          buildOne({ table, title, noHeading });
        if (gridImage)      buildOne({ gridImage });
        if (inlineImage)    buildOne({ inlineImage });
        if (dynamicContent) buildOne({ dynamic: dynamicContent });
        if (mapContent)     buildOne({ map: mapContent });
        if (latex)          buildOne({ latex });
        if (contentItems)   buildOne({ contentItems });

        // ── tipe baru ──
        if (richImage)   buildOne({ richImage });
        if (richVideo)   buildOne({ richVideo });
        if (reels)       buildOne({ reels });
        if (source)      buildOne({ source });
        if (richProduct) buildOne({ richProduct });
        if (richPost)    buildOne({ richPost });
        if (contentText) buildOne({ text: contentText }); // ← setelah produk/post, tampil di bawah card
        if (tip)         buildOne({ tip });
        if (suggest)     buildOne({ suggest });
        if (richWidget ?? widget) buildOne({ widget: richWidget ?? widget });
        if (richFooterAction ?? footerAction) buildOne({ footerAction: richFooterAction ?? footerAction });
        if (richMetadata ?? metadata) buildOne({ metadata: richMetadata ?? metadata });
        if (richFOAText ?? foaText) buildOne({ foaText: richFOAText ?? foaText });
        if (richHtml != null) buildOne({ richHtml });

        /* links — bisa dikombinasi dengan tipe lain di atas */
        if (links && Array.isArray(links)) {
            links.forEach((linkField, index) => {
                const prefix = 'SS_' + index;
                const url = (linkField.url && /^https?:\/\//i.test(linkField.url)) ? linkField.url : null;
                if (!url) {
                    console.warn('[baileys] links[].url kosong/tidak valid (harus http:// atau https://) — link ini dilewati.');
                    return;
                }
                const linkSources = (linkField.sources || []).map(s => ({
                    source_type: 'THIRD_PARTY',
                    source_display_name: s.displayName || 'Source',
                    source_subtitle: s.subtitle || '',
                    source_url: s.url || url
                }));
                const s = makeTextSub(
                    linkField.text + ` {{${prefix}}}¹{{/${prefix}}} `,
                    [{
                        key: prefix,
                        metadata: {
                            reference_id: index + 1,
                            reference_url: url,
                            reference_title: linkField.title || url,
                            reference_display_name: linkField.displayName || url,
                            sources: linkSources,
                            __typename: 'GenAISearchCitationItem'
                        }
                    }]
                );
                push(s, buildUnifiedSection(s));
            });
        }

        if (footerText) buildOne({ text: footerText });
    }

    const unified = { response_id: randomUUID(), sections };

    const richResponseMessage = proto.AIRichResponseMessage.create({
        submessages,
        messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
        unifiedResponse: {
            data: Buffer.from(JSON.stringify(unified), 'utf-8')
        },
        contextInfo: {
            isForwarded: true,
            forwardingScore: 1,
            ...(aiForwarded === true ? { forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' } } : {}),
            forwardOrigin: 4
        }
    });

    const message = wrapToBotForwardedMessage(richResponseMessage);
    const botMetadata = message.messageContextInfo.botMetadata;

    if (disclaimerText) {
        botMetadata.messageDisclaimerText = disclaimerText;
    }
    botMetadata.botResponseId = unified.response_id;

    return message;
};

/* ─────────────────────────────────────────────────────────────
   BOT WRAPPER HELPERS
───────────────────────────────────────────────────────────── */

export const botMetadataSignature = () => {
    const signature = new Uint8Array(64);
    getRandomValues(signature);
    return signature;
};

export const botMetadataCertificate = (length = 685) => {
    const certificate = new Uint8Array(length);
    certificate[0] = 48;
    certificate[1] = 130;
    getRandomValues(certificate.subarray(2));
    return certificate;
};

export const wrapToBotForwardedMessage = (richResponseMessage) => ({
    messageContextInfo: {
        botMetadata: {
            verificationMetadata: {
                proofs: [
                    {
                        certificateChain: [
                            botMetadataCertificate(),
                            botMetadataCertificate(892)
                        ],
                        version: 1,
                        useCase: 1,
                        signature: botMetadataSignature()
                    }
                ]
            }
        }
    },
    botForwardedMessage: {
        message: { richResponseMessage }
    }
});

/* ─────────────────────────────────────────────────────────────
   STANDALONE GENERATORS (kompatibel dengan baileys upstream)
   Semua fungsi di bawah ini di-port dari baileys-main/src/Utils/rich-messages.js
   agar API pontalabs 100% kompatibel dengan baileys — termasuk sendTable, sendLatex, dll.
───────────────────────────────────────────────────────────── */

/* helper: bangun contextInfo dari quoted */
const buildRichContextInfo = (quoted) => {
    const ctxInfo = {
        isForwarded: true,
        forwardingScore: 1,
        forwardOrigin: 4,
    };
    if (quoted?.key) {
        ctxInfo.stanzaId = quoted.key.id;
        ctxInfo.participant = quoted.key.participant || quoted.sender || quoted.key.remoteJid;
        ctxInfo.quotedMessage = quoted.message;
    }
    return ctxInfo;
};

/* helper: wrap submessages + contextInfo ke botForwardedMessage (format lama/V1) */
const buildBotForwardedMessage = (submessages, contextInfo, unifiedResponse) => {
    const richResponse = { messageType: 1, submessages, contextInfo };
    if (unifiedResponse) richResponse.unifiedResponse = unifiedResponse;
    return { botForwardedMessage: { message: { richResponseMessage: richResponse } } };
};

/* helper: wrap proto AIRichResponseMessage ke botForwardedMessage dengan messageContextInfo */
const _wrapProtoToResult = (submessages, quoted) => {
    const unified = toUnified(submessages);
    const richResponseMessage = proto.AIRichResponseMessage.create({
        submessages,
        messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
        unifiedResponse: { data: Buffer.from(JSON.stringify(unified), 'utf-8') },
        contextInfo: buildRichContextInfo(quoted),
    });
    return { message: wrapToBotForwardedMessage(richResponseMessage), messageId: generateMessageIDV2() };
};

// ── Table ──────────────────────────────────────────────────

export const generateTableContent = (title, headers, rows, quoted, options = {}) => {
    const { footer, headerText } = options;
    const tableRows = [{ items: headers, isHeading: true }, ...rows.map(row => ({ items: row.map(String) }))];
    const subs = [];
    if (headerText) subs.push({ messageType: RichSubMessageType.TEXT, messageText: headerText });
    subs.push({ messageType: RichSubMessageType.TABLE, tableMetadata: { title, rows: tableRows } });
    if (footer) subs.push({ messageType: RichSubMessageType.TEXT, messageText: footer });
    return _wrapProtoToResult(subs, quoted);
};

export const generateListContent = (title, items, quoted, options = {}) => {
    const { footer, headerText } = options;
    const tableRows = items.map(item => ({ items: Array.isArray(item) ? item.map(String) : [String(item)] }));
    const subs = [];
    if (headerText) subs.push({ messageType: RichSubMessageType.TEXT, messageText: headerText });
    subs.push({ messageType: RichSubMessageType.TABLE, tableMetadata: { title, rows: tableRows } });
    if (footer) subs.push({ messageType: RichSubMessageType.TEXT, messageText: footer });
    return _wrapProtoToResult(subs, quoted);
};

export const toTableMetadataV2 = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Input must be a non-empty array');
    const [title, headerStr, ...rest] = arr;
    const splitCols = (str) => typeof str !== 'string' ? [] : str.includes('|') ? str.split('|').map(s => s.trim()) : str.split(',').map(s => s.trim());
    const splitRows = (str) => typeof str !== 'string' ? [] : str.split(';;').map(row => splitCols(row));
    const header = splitCols(headerStr);
    const parsedRows = rest.flatMap(splitRows);
    const maxLen = Math.max(header.length, ...parsedRows.map(r => r.length));
    const unified_rows = [
        { is_header: true, cells: [...header, ...Array(maxLen - header.length).fill('')] },
        ...parsedRows.map(cells => ({ is_header: false, cells: [...cells, ...Array(maxLen - cells.length).fill('')] }))
    ];
    const rows = unified_rows.map(r => ({ items: r.cells, ...(r.is_header ? { isHeading: true } : {}) }));
    return { title, rows, unified_rows };
};


// ── Code Block ────────────────────────────────────────────

export const generateCodeBlockContent = (code, quoted, options = {}) => {
    const { title, footer, language = 'javascript' } = options;
    const subs = [];
    if (title) subs.push({ messageType: RichSubMessageType.TEXT, messageText: title });
    subs.push({ messageType: RichSubMessageType.CODE, codeMetadata: { codeLanguage: language, codeBlocks: tokenizeCode(code, language) } });
    if (footer) subs.push({ messageType: RichSubMessageType.TEXT, messageText: footer });
    return _wrapProtoToResult(subs, quoted);
};


// ── Rich Message (generic) ────────────────────────────────

export const generateRichMessageContent = (submessages, quoted) => {
    return _wrapProtoToResult(submessages, quoted);
};

export const generateUnifiedResponseContent = (quoted, captured) => {
    const richResponseMessage = proto.AIRichResponseMessage.create({
        submessages: captured.submessages,
        messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
        unifiedResponse: captured.unifiedResponse,
        contextInfo: buildRichContextInfo(quoted),
    });
    return { message: wrapToBotForwardedMessage(richResponseMessage), messageId: generateMessageIDV2() };
};

export const captureUnifiedResponse = (msg) => {
    const botFwd = msg?.botForwardedMessage?.message;
    if (!botFwd) return null;
    const rich = botFwd.richResponseMessage;
    if (!rich?.unifiedResponse?.data) return null;
    return { unifiedResponse: { data: rich.unifiedResponse.data }, submessages: rich.submessages || [], contextInfo: rich.contextInfo || {} };
};

// ── Link ──────────────────────────────────────────────────

export const generateLinkContent = (text, links, quoted, options = {}) => {
    const { footer, forwardingScore = 3, citations = [], proofs = [] } = options;
    const subs = [];
    const fullText = footer ? `${text}${footer}` : text;
    subs.push({ messageType: RichSubMessageType.TEXT, messageText: fullText });
    const sections = [];
    const inlineEntities = links.map((link, i) => {
        const url = typeof link === 'string' ? link : link.url;
        const displayName = typeof link === 'object' && link.displayName ? link.displayName : citations[i]?.sourceTitle || `Link ${i + 1}`;
        return { key: `IE_${i}`, metadata: { display_name: displayName, is_trusted: false, url, __typename: 'GenAIInlineLinkItem' } };
    });
    sections.push({ view_model: { primitive: { text, inline_entities: inlineEntities, __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
    if (footer) sections.push({ view_model: { primitive: { text: footer, __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
    // using randomUUID and randomBytes from top-level import
    const base64Data = Buffer.from(JSON.stringify({ response_id: randomUUID(), sections })).toString('base64');
    const ctxInfo = buildRichContextInfo(quoted);
    ctxInfo.forwardingScore = forwardingScore;
    ctxInfo.botMessageSharingInfo = { forwardScore: forwardingScore };
    const messageContextInfo = { messageSecret: randomBytes(32) };
    if (citations.length > 0 || proofs.length > 0) {
        const botMetadata = {};
        if (citations.length > 0) botMetadata.richResponseSourcesMetadata = { sources: citations.map((c, i) => ({ provider: 1, thumbnailCdnUrl: '', sourceProviderUrl: typeof links[i] === 'string' ? links[i] : links[i]?.url || '', sourceQuery: c.sourceQuery || '', faviconCdnUrl: c.faviconCdnUrl || '', citationNumber: c.citationNumber ?? i + 1, sourceTitle: c.sourceTitle || '' })) };
        if (proofs.length > 0) botMetadata.verificationMetadata = { proofs: proofs.map(p => ({ version: p.version || 1, useCase: p.useCase || 1, signature: p.signature || '', certificateChain: p.certificateChain || [] })) };
        messageContextInfo.botMetadata = botMetadata;
    }
    const content = { messageContextInfo, botForwardedMessage: { message: { richResponseMessage: { messageType: 1, submessages: subs, unifiedResponse: { data: base64Data }, contextInfo: ctxInfo } } } };
    return { message: content, messageId: generateMessageIDV2() };
};


// ── LaTeX (3 varian, port dari baileys) ──────────────────

/**
 * generateLatexContent — kirim LaTeX dengan URL gambar yang sudah ada (pre-rendered).
 * Jika `expr.url` tidak diisi, otomatis di-generate via buildLatexUrl (codecogs).
 *
 * @param {object} quoted   - pesan yang di-quote (boleh null)
 * @param {object} options  - { text, expressions, headerText, footer }
 *   expressions: Array<{ latexExpression, url?, width?, height?,
 *                         fontHeight?, imageTopPadding?, imageLeadingPadding?,
 *                         imageBottomPadding?, imageTrailingPadding? }>
 */
export const generateLatexContent = (quoted, options) => {
    const { text, expressions, headerText, footer } = options;
    const subs = [];
    if (headerText) subs.push({ messageType: RichSubMessageType.TEXT, messageText: headerText });
    const latexExpressions = expressions.map((expr) => {
        const entry = {
            latexExpression: expr.latexExpression,
            url: expr.url || buildLatexUrl(expr.latexExpression),
            width: expr.width ?? 120,
            height: expr.height ?? 40,
        };
        if (expr.fontHeight !== undefined) entry.fontHeight = expr.fontHeight;
        if (expr.imageTopPadding !== undefined) entry.imageTopPadding = expr.imageTopPadding;
        if (expr.imageLeadingPadding !== undefined) entry.imageLeadingPadding = expr.imageLeadingPadding;
        if (expr.imageBottomPadding !== undefined) entry.imageBottomPadding = expr.imageBottomPadding;
        if (expr.imageTrailingPadding !== undefined) entry.imageTrailingPadding = expr.imageTrailingPadding;
        return entry;
    });
    subs.push({ messageType: RichSubMessageType.LATEX, latexMetadata: { text: text || '', expressions: latexExpressions } });
    if (footer) subs.push({ messageType: RichSubMessageType.TEXT, messageText: footer });
    return _wrapProtoToResult(subs, quoted);
};

/**
 * generateLatexImageContent — render LaTeX ke PNG via renderLatexToPng,
 * upload via uploadFn, kirim sebagai LaTeX message dengan URL hasil upload.
 *
 * @param {object}   quoted           - pesan yang di-quote (boleh null)
 * @param {object}   options          - { text, expressions, headerText, footer }
 * @param {Function} uploadFn         - async (buffer, type) => { url, directPath }
 * @param {Function} renderLatexToPng - async (latexExpression) => { buffer, width, height }
 */
export const generateLatexImageContent = async (quoted, options, uploadFn, renderLatexToPng) => {
    const { text, expressions, headerText, footer } = options;
    const subs = [];
    if (headerText) subs.push({ messageType: RichSubMessageType.TEXT, messageText: headerText });
    const latexExpressions = await Promise.all(
        expressions.map(async (expr) => {
            const { buffer, width, height } = await renderLatexToPng(expr.latexExpression);
            const uploadResult = await uploadFn(buffer, 'image');
            const imageUrl = uploadResult.url || uploadResult.directPath;
            return { latexExpression: expr.latexExpression, url: imageUrl, width, height };
        }),
    );
    subs.push({ messageType: RichSubMessageType.LATEX, latexMetadata: { text: text || '', expressions: latexExpressions } });
    if (footer) subs.push({ messageType: RichSubMessageType.TEXT, messageText: footer });
    return _wrapProtoToResult(subs, quoted);
};

/**
 * generateLatexInlineImageContent — render LaTeX ke PNG, upload, kirim sebagai
 * deretan INLINE_IMAGE (satu per expression). Fallback untuk klien tanpa LaTeX native.
 *
 * @param {object}   quoted           - pesan yang di-quote (boleh null)
 * @param {object}   options          - { text, expressions, headerText, footer }
 * @param {Function} uploadFn         - async (buffer, type) => { url, directPath }
 * @param {Function} renderLatexToPng - async (latexExpression) => { buffer, width, height }
 */
export const generateLatexInlineImageContent = async (quoted, options, uploadFn, renderLatexToPng) => {
    const { text, expressions, headerText, footer } = options;
    const subs = [];
    if (headerText) subs.push({ messageType: RichSubMessageType.TEXT, messageText: headerText });
    if (text) subs.push({ messageType: RichSubMessageType.TEXT, messageText: text });
    for (const expr of expressions) {
        const { buffer, width, height } = await renderLatexToPng(expr.latexExpression);
        const uploadResult = await uploadFn(buffer, 'image');
        const imageUrl = uploadResult.url || uploadResult.directPath;
        subs.push({
            messageType: RichSubMessageType.INLINE_IMAGE,
            imageMetadata: {
                imageUrl: { imagePreviewUrl: imageUrl, imageHighResUrl: imageUrl },
                imageText: expr.latexExpression,
                alignment: 2,
            },
        });
    }
    if (footer) subs.push({ messageType: RichSubMessageType.TEXT, messageText: footer });
    return _wrapProtoToResult(subs, quoted);
};

// ── tokenizeCodeV2 (dipakai oleh generateCodeBlockContentV2) ─


/* ─────────────────────────────────────────────────────────────
   README COMPAT LAYER
   Menerjemahkan nama-nama field lama (dipakai di README/dokumentasi
   PontaLabs) ke nama field internal fork ini, supaya semua contoh
   di README tetap jalan tanpa perlu belajar nama baru.
───────────────────────────────────────────────────────────── */

const mapProductFields = (data) => {
    const one = (p) => ({
        title: p.title,
        brand: p.brand,
        price: p.price_display_string ?? p.price,
        sale_price: p.sale_price_display_string ?? p.sale_price,
        product_url: p.product_url ?? p.url,
        image_url: p.thumbnail?.url ?? p.image_url ?? p.image,
        icon_url: p.icon_url ?? p.icon
    });
    return Array.isArray(data) ? data.map(one) : one(data);
};

const mapPostFields = (data) => {
    const one = (p) => ({
        title: p.title,
        subtitle: p.subtitle,
        username: p.author_display_name ?? p.username,
        profile_picture_url: p.author_profile_image ?? p.profile_picture_url,
        is_verified: p.is_verified,
        thumbnail_url: p.media_url ?? p.thumbnail_url ?? p.thumbnail,
        post_caption: p.post_caption ?? p.caption,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        shares_count: p.shares_count,
        post_url: p.post_url,
        post_deeplink: p.post_deeplink,
        source_app: p.source_app,
        footer_label: p.footer_label,
        footer_icon: p.footer_icon,
        orientation: p.orientation,
        post_type: p.post_type
    });
    return Array.isArray(data) ? data.map(one) : one(data);
};

const mapSourceFields = (data) => {
    const list = Array.isArray(data) ? data : [data];
    return list.map((s) => {
        if (Array.isArray(s)) {
            const [faviconUrl, sourceUrl, displayName] = s;
            return { url: sourceUrl, display_name: displayName, favicon: faviconUrl };
        }
        return {
            url: s.source_url ?? s.url,
            title: s.reference_title ?? s.title,
            display_name: s.source_display_name ?? s.displayName ?? s.display_name,
            subtitle: s.source_subtitle ?? s.subtitle,
            source_type: s.source_type,
            favicon: s.favicon?.url ?? s.favicon ?? s.faviconCDNURL
        };
    });
};

const mapLatexFields = (data) => {
    if (typeof data === 'string') {
        return { text: '', expressions: [{ url: data }] };
    }
    return {
        text: data.text ?? '',
        expressions: [{
            url: data.url,
            width: data.width,
            height: data.height,
            fontHeight: data.font_height,
            imageTopPadding: data.padding,
            imageBottomPadding: data.padding
        }]
    };
};

const mapVideoField = (data) => {
    const one = (v) => {
        if (typeof v === 'string')
            return v;
        return `${v.url}|${v.duration || 0}`;
    };
    return Array.isArray(data) ? data.map(one) : one(data);
};

/** Terjemahkan satu item README-style ({images},{videoUrl},{suggestions}, dst)
 *  jadi item internal fork ({richImage},{richVideo},{suggest}, dst). */
const translateReadmeItem = (item) => {
    const out = {};
    // Builder aliases: build.* returns lightweight items that can be passed
    // directly to sendMessage({ items: [...] }).
    if (item.richText != null) { out.text = item.richText; }
    if (item.richFOAText != null) { out.foaText = item.richFOAText; }
    if (item.richHtml != null) { out.richHtml = item.richHtml; }
    if (item.richCard != null) { out.richCard = item.richCard; }
    if (item.richCode != null) { out.code = item.richCode; out.language = item.language; }
    if (item.richTable != null) { out.table = item.richTable; }
    if (item.richSource != null) { out.source = item.richSource; }
    if (item.richReels != null) { out.reels = item.richReels; }
    if (item.richImage != null) { out.richImage = item.richImage; }
    if (item.richVideo != null) { out.richVideo = mapVideoField(item.richVideo); }
    if (item.richProduct != null) { out.richProduct = mapProductFields(item.richProduct); }
    if (item.richPost != null) { out.richPost = mapPostFields(item.richPost); }
    if (item.richMetadata != null) { out.metadata = item.richMetadata; }
    if (item.richTip != null) { out.tip = item.richTip; }
    if (item.richWidget != null) { out.widget = item.richWidget; }
    if (item.richFooterAction != null) { out.footerAction = item.richFooterAction; }
    if (item.richSuggest != null) { out.suggest = item.richSuggest; }
    if (item.text != null) { out.text = item.text; if (item.inlineEntities) out.inlineEntities = item.inlineEntities; }
    if (item.code != null) { out.code = item.code; out.language = item.language; }
    if (item.table != null) {
        const norm = normalizeTableInput(item.table, item.title, item.noHeading);
        out.table = norm.rows;
        if (norm.title != null) out.title = norm.title;
        if (norm.noHeading != null) out.noHeading = norm.noHeading;
    }
    if (item.images != null) out.richImage = item.images;
    if (item.videoUrl != null) out.richVideo = mapVideoField({ url: item.videoUrl, duration: item.duration });
    if (item.video != null) out.richVideo = mapVideoField(item.video);
    if (item.suggestions != null) out.suggest = item.suggestions;
    if (item.latexUrl != null) out.latex = mapLatexFields({ url: item.latexUrl, text: item.latexText, width: item.latexWidth, height: item.latexHeight });
    if (item.latex != null) out.latex = mapLatexFields(item.latex);
    if (item.product != null) out.richProduct = mapProductFields(item.product);
    if (item.post != null) out.richPost = mapPostFields(item.post);
    if (item.reels != null) out.reels = item.reels;
    if (item.sources != null) out.source = mapSourceFields(item.sources);
    if (item.tip != null) out.tip = item.tip;
    if (item.footer != null) out.text = item.footer;
    return Object.keys(out).length ? out : item;
};

/** Terapkan alias README ke object `message` sebelum diproses generateWAMessageContent.
 *  Memanipulasi & mengembalikan object yang sama (mutasi in-place, aman dipanggil sekali). */
export const applyReadmeRichAliases = (message) => {
    if (!message || typeof message !== 'object')
        return message;

    // richText -> gabungkan ke contentText (tampil sebagai teks)
    if (message.richText != null && message.contentText == null) {
        message.contentText = Array.isArray(message.richText) ? message.richText.join('\n\n') : message.richText;
        delete message.richText;
    }
    // codes (multi code block) -> richResponse array
    if (Array.isArray(message.codes) && message.richResponse == null) {
        message.richResponse = message.codes.map((c) => ({ code: c.code, language: c.language }));
        delete message.codes;
    }
    // items (mixed mode) -> richResponse array (translate tiap item)
    if (Array.isArray(message.items) && message.richResponse == null) {
        message.richResponse = message.items.map(translateReadmeItem);
        delete message.items;
    }
    // richResponse array -> translate tiap item ke nama internal
    if (Array.isArray(message.richResponse)) {
        message.richResponse = message.richResponse.map(translateReadmeItem);
    }
    // richImages -> richImage
    if (message.richImages != null && message.richImage == null) {
        message.richImage = message.richImages;
        delete message.richImages;
    }
    // richVideo (object/array/string) -> string "url|duration" yang dipahami fork ini
    if (message.richVideo != null) {
        message.richVideo = mapVideoField(message.richVideo);
    }
    // richSuggestions -> suggest
    if (message.richSuggestions != null && message.suggest == null) {
        message.suggest = message.richSuggestions;
        delete message.richSuggestions;
    }
    // richLatex -> latex
    if (message.richLatex != null && message.latex == null) {
        message.latex = mapLatexFields(message.richLatex);
        delete message.richLatex;
    }
    // richProduct fields -> internal field names
    if (message.richProduct != null) {
        message.richProduct = mapProductFields(message.richProduct);
    }
    // richPost fields -> internal field names
    if (message.richPost != null) {
        message.richPost = mapPostFields(message.richPost);
    }
    // richReels -> reels (field-field sudah kompatibel)
    if (message.richReels != null && message.reels == null) {
        message.reels = message.richReels;
        delete message.richReels;
    }
    // richSources -> source
    if (message.richSources != null && message.source == null) {
        message.source = mapSourceFields(message.richSources);
        delete message.richSources;
    }
    // richTip -> tip
    if (message.richTip != null && message.tip == null) {
        message.tip = message.richTip;
        delete message.richTip;
    }
    // Builder 4.7 aliases; shortcut lama tidak diubah.
    if (message.richWidget != null && message.widget == null) { message.widget = message.richWidget; delete message.richWidget; }
    if (message.richFooterAction != null && message.footerAction == null) { message.footerAction = message.richFooterAction; delete message.richFooterAction; }
    if (message.richMetadata != null && message.metadata == null) { message.metadata = message.richMetadata; delete message.richMetadata; }
    if (message.richFOAText != null && message.foaText == null) { message.foaText = message.richFOAText; delete message.richFOAText; }
    // richFooter -> footerText
    if (message.richFooter != null && message.footerText == null) {
        message.footerText = message.richFooter;
        delete message.richFooter;
    }
    // richMessage (legacy inline parse): [text](url), [](url) sitasi, [rumus|w|h](rumus) latex
    if (message.richMessage != null && message.richResponse == null && message.text == null) {
        const raw = typeof message.richMessage === 'string' ? message.richMessage : message.richMessage.text;
        const pattern = /\[([^\]]*)\]\(([^)]+)\)/g;
        const inlineEntities = [];
        let idx = 0;
        const text = raw.replace(pattern, (_match, label, target) => {
            const parts = label.split('|');
            if (parts.length === 3) {
                // [rumus|w|h](rumus) -> latex inline (fallback: sisipkan sebagai teks + expressions terpisah tidak didukung inline,
                // jadi dikonversi jadi placeholder teks + latex submessage terpisah)
                return `${parts[0]} (lihat rumus di bawah)`;
            }
            const key = 'SS_' + idx++;
            inlineEntities.push({
                key,
                metadata: {
                    reference_id: idx,
                    reference_url: target,
                    reference_title: label || target,
                    reference_display_name: label || target,
                    sources: [{ source_type: 'THIRD_PARTY', source_display_name: label || target, source_url: target }],
                    __typename: 'GenAISearchCitationItem'
                }
            });
            return label ? `${label} {{${key}}}¹{{/${key}}}` : ` {{${key}}}¹{{/${key}}}`;
        });
        message.richResponse = [{ text, inlineEntities: inlineEntities.length ? inlineEntities : undefined }];
        delete message.richMessage;
    }
    // groupStatus dalam bentuk object README ({ message, audienceType, backgroundArgb, textArgb, font })
    // -> pecah jadi content biasa + flag groupStatus + styling langsung di top-level message
    if (message.groupStatus != null && typeof message.groupStatus === 'object' && !Array.isArray(message.groupStatus)) {
        const gs = message.groupStatus;
        if (typeof gs.message === 'string') {
            message.text = gs.message;
        }
        else if (gs.message && typeof gs.message === 'object') {
            Object.assign(message, gs.message);
        }
        if (gs.backgroundArgb != null) message.backgroundArgb = gs.backgroundArgb;
        if (gs.textArgb != null) message.textArgb = gs.textArgb;
        if (gs.font != null) message.font = gs.font;
        message.groupStatus = { audienceType: gs.audienceType ?? 0 };
    }
    // buttonLocation.listMenu / listSectionTitle -> buttonLocation.sections
    if (message.buttonLocation != null && Array.isArray(message.buttonLocation.listMenu) && message.buttonLocation.sections == null) {
        message.buttonLocation.sections = [{
            title: message.buttonLocation.listSectionTitle || '',
            rows: message.buttonLocation.listMenu
        }];
    }
    return message;
};


//# sourceMappingURL=rich-message-utils.js.map

/* ─────────────────────────────────────────────────────────────
   Class Rich — builder satu pintu untuk sendRich.
   Contoh:
     await new Rich(conn)
       .addText('Halo, ini ringkasan:')
       .addTable({ title: 'Harga', headers: ['Barang', 'Harga'], rows: [['Kopi', '10rb']] })
       .addCode('javascript', "console.log('hi')")
       .addHtml('<h1>Judul</h1><p>Isi <b>tebal</b></p>')
       .addTip('Tip: balas pesan ini untuk lanjut')
       .addSuggest(['Lihat menu', 'Bantuan'])
       .send(jid)
   .build() mengembalikan pesan siap kirim (botForwardedMessage);
   .send(jid) memanggil conn.sendMessage langsung.
───────────────────────────────────────────────────────────── */
export class Rich {
    constructor(conn) {
        this.conn = conn;
        this.items = [];
        this.headerText = undefined;
        this.footerText = undefined;
        this.disclaimerText = undefined;
    }
    setHeader(text) { this.headerText = text; return this; }
    setFooter(text) { this.footerText = text; return this; }
    setDisclaimer(text) { this.disclaimerText = text; return this; }
    addText(text) { this.items.push({ text }); return this; }
    addHtml(html) { this.items.push({ richHtml: html }); return this; }
    addCode(language, code) { this.items.push({ code, language }); return this; }
    addTable(table, title, noHeading) { this.items.push({ table, title, noHeading }); return this; }
    addImage(imageUrl) { this.items.push({ richImage: imageUrl }); return this; }
    addVideo(videoUrl) { this.items.push({ richVideo: videoUrl }); return this; }
    addReels(reelsItems) { this.items.push({ reels: reelsItems }); return this; }
    addProduct(data) { this.items.push({ richProduct: data }); return this; }
    addPost(data) { this.items.push({ richPost: data }); return this; }
    addTip(text) { this.items.push({ tip: text }); return this; }
    addSuggest(suggestion) { this.items.push({ suggest: suggestion }); return this; }
    addSource(sources) { this.items.push({ source: sources }); return this; }
    addMetadata(text) { this.items.push({ metadata: text }); return this; }
    addWidget(data) { this.items.push({ widget: data }); return this; }
    addFooterAction(data) { this.items.push({ footerAction: data }); return this; }
    addCard(data) { this.items.push({ richCard: data }); return this; }
    addMap(centerLatitude, centerLongitude, options = {}) { this.items.push({ map: { centerLatitude, centerLongitude, ...options } }); return this; }
    addLatex(text, expressions = []) { this.items.push({ latex: { text, expressions } }); return this; }
    addGridImage(gridImageUrl, imageUrls = []) { this.items.push({ gridImage: { gridImageUrl, imageUrls } }); return this; }
    addInlineImage(imageUrl, imageText = '', alignment = 0, tapLinkUrl = null) { this.items.push({ inlineImage: { imageUrl, imageText, alignment, tapLinkUrl } }); return this; }
    build() {
        return prepareRichResponseMessage({
            richResponse: this.items,
            headerText: this.headerText,
            footerText: this.footerText,
            disclaimerText: this.disclaimerText,
        });
    }
    send(jid, options = {}) { return this.conn.sendMessage(jid, this.build(), options); }
}
