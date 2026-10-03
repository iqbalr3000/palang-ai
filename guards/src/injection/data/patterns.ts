import type { InjectionPattern } from "../types.js";

// Every quantifier is bounded so an adversarial input can't trigger catastrophic backtracking.
export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    id: "en-ignore-previous",
    lang: "en",
    weight: 0.9,
    regex:
      /\b(?:ignore|disregard|forget|override)\b(?:\s+\w+){0,3}\s+(?:instructions?|prompts?|rules|guidelines|directives|instruksi|perintah|aturan|petunjuk|arahan)\b/,
  },
  {
    id: "en-reveal-prompt",
    lang: "en",
    weight: 0.8,
    regex:
      /\b(?:reveal|show|print|repeat|output|display|leak|tell\s+me)\b(?:\s+\w+){0,4}\s+(?:system|initial|hidden|original)\s+(?:prompt|instructions?|message)\b/,
  },
  {
    id: "en-repeat-above",
    lang: "en",
    weight: 0.5,
    regex: /\brepeat\s+(?:the\s+)?(?:words|text)\s+above\b/,
  },
  {
    id: "en-role-override",
    lang: "en",
    weight: 0.3,
    regex: /\byou\s+are\s+now\b/,
  },
  {
    id: "en-no-restrictions",
    lang: "en",
    weight: 0.4,
    regex:
      /\b(?:without|with\s+no|free\s+(?:of|from))\s+(?:any\s+)?(?:restrictions?|filters?|limitations?|guidelines|censorship)\b/,
  },
  {
    id: "en-jailbreak-persona",
    lang: "en",
    weight: 0.85,
    regex: /\b(?:do\s+anything\s+now|dan\s+mode|jailbreak\s+mode|god\s+mode)\b/,
  },
  {
    id: "en-developer-mode",
    lang: "en",
    weight: 0.4,
    regex: /\bdeveloper\s+mode\b/,
  },
  {
    id: "en-new-instructions",
    lang: "en",
    weight: 0.5,
    regex: /\b(?:new|updated|revised)\s+(?:instructions?|rules|system\s+prompt)\s*:/,
  },
  {
    id: "id-ignore-previous",
    lang: "id",
    weight: 0.9,
    regex:
      /\b(?:(?:meng|di)?abaikan(?:lah)?|acuhkan|lupakan(?:lah)?|lupain|cuekin|kesampingkan|hiraukan|(?:jangan|tidak\s+(?:usah|perlu))\s+(?:ikuti|ikutin|patuhi|follow))\b(?:\s+\w+){0,3}\s+(?:instruksi|perintah|petunjuk|arahan|aturan|prompt|instructions?|rules|guidelines|prompts)\b/,
  },
  {
    id: "id-reveal-prompt",
    lang: "id",
    weight: 0.8,
    regex:
      /\b(?:tampilkan|ungkapkan|tunjukkan|tunjukin|bocorkan|bocorin|cetak|ulangi|sebutkan|beritahu(?:kan)?|kasih\s+(?:tau|tahu)|reveal|show|print|leak|display|output)\b(?:\s+\w+){0,4}\s+(?:system\s+prompt|prompt\s+sistem|instruksi\s+(?:sistem|awal|asli|tersembunyi)|prompt\s+(?:awal|asli|tersembunyi))\b/,
  },
  {
    id: "id-role-override",
    lang: "id",
    weight: 0.3,
    regex:
      /\b(?:(?:kamu|anda|engkau)\s+(?:sekarang|kini)\s+(?:adalah|menjadi)|mulai\s+sekarang,?\s+(?:kamu|anda|you\s+are)|(?:sekarang|kini)\s+(?:kamu|anda)\s+bebas)\b/,
  },
  {
    id: "id-no-restrictions",
    lang: "id",
    weight: 0.4,
    regex:
      /\b(?:(?:tanpa|bebas\s+dari)\s+(?:(?:ada|semua|segala|seluruh)\s+)?(?:batasan|pembatasan|filter|sensor|aturan|restrictions?|rules|filters|limits?)|tidak\s+ada\s+(?:lagi\s+)?(?:aturan|batasan|sensor|filter))\b/,
  },
  {
    id: "id-jailbreak-persona",
    lang: "id",
    weight: 0.85,
    regex: /\b(?:mode\s+(?:dewa|tanpa\s+batas)|lakukan\s+apa\s+saja\s+sekarang)\b/,
  },
  {
    id: "id-developer-mode",
    lang: "id",
    weight: 0.4,
    regex: /\bmode\s+pengembang\b/,
  },
  {
    id: "id-pretend",
    lang: "id",
    weight: 0.3,
    regex:
      /\b(?:berpura-pura|pura-pura|(?:anggap|anggep)\s+(?:(?:aja|saja)\s+)?(?:dirimu|kamu)|bayangkan\s+kamu)\b/,
  },
  {
    id: "id-new-instructions",
    lang: "id",
    weight: 0.5,
    regex: /\b(?:instruksi|perintah|aturan)\s+(?:baru|terbaru|tambahan)(?:\s+(?:nih|ya|ini))?\s*:/,
  },
  {
    id: "en-forget-everything",
    lang: "en",
    weight: 0.7,
    regex:
      /\b(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:(?:that\s+)?(?:was\s+)?(?:said|written)|above|before|prior|previously|you\s+(?:were|have\s+been)\s+told)\b/,
  },
  {
    id: "id-forget-everything",
    lang: "id",
    weight: 0.7,
    regex:
      /\b(?:lupakan|abaikan|acuhkan|hiraukan)\s+(?:semua|segala|seluruh)\s+(?:yang\s+)?(?:dikatakan|ditulis|disebutkan|diberikan)\s+(?:sebelum|di\s+atas)/,
  },
  {
    id: "id-invalidate-previous",
    lang: "id",
    weight: 0.7,
    regex:
      /\b(?:(?:semua|segala)\s+(?:yang\s+)?|yang\s+tadi\s+)(?:dikatakan|ditulis|disebutkan|diberikan|dibilang)\s+(?:sebelum(?:nya)?|di\s+atas)(?:\s+\w+){0,4}\s+(?:tidak\s+(?:berlaku|valid)|not\s+valid|batal|salah)\b/,
  },
  {
    id: "any-fake-delimiter",
    lang: "any",
    weight: 0.7,
    regex:
      /<\|(?:im_start|im_end|system|endoftext)\|>|\[\/?inst\]|<<\/?sys>>|\[\s*system\s*\]|#{2,}\s*(?:system|instructions?)\b/,
  },
  {
    id: "any-exfil-markdown-image",
    lang: "any",
    weight: 0.7,
    regex:
      /!\[[^\]]{0,100}\]\(\s*https?:\/\/[^)\s]{0,300}[?&][^)\s=]{1,50}=[^)\s]{0,200}(?:\{|%7b|\[)[^)\s]{0,100}\)/,
  },
  {
    id: "any-exfil-html-image",
    lang: "any",
    weight: 0.7,
    regex:
      /<img\b[^>]{0,200}\bsrc\s*=\s*["']?https?:\/\/[^"'\s>]{0,300}[?&][^"'\s=>]{1,50}=[^"'\s>]{0,200}(?:\{|%7b|\[)/,
  },
];
