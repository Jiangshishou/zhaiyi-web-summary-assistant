import type { OutputCompressionMode, SourcePayload } from "../shared/types";

type SummarySourceStrategyId =
  | "generic"
  | "x-thread"
  | "x-article"
  | "forum"
  | "video"
  | "blog"
  | "doc"
  | "repo"
  | "news"
  | "xiaohongshu"
  | "weixin";
interface SummarySourceStrategy {
  label: string;
  description: string;
  focus: string;
}

export type SummaryRequestPlan = {
  sourceContext: string;
  lengthGuidance: string;
  extractionStatus: string;
};

const SOURCE_STRATEGIES: Record<SummarySourceStrategyId, SummarySourceStrategy> = {
  generic: {
    label: "通用精读",
    description: "平衡提炼结构、关键事实、核心结论与后续价值。",
    focus: "优先提炼页面结构、关键事实、核心结论、论证链、可复用信息和后续注意点。"
  },
  news: {
    label: "新闻速读",
    description: "优先时间线、事件主体、关键事实、直接影响与未决问题。",
    focus: "优先整理事件背景、关键时间线、涉及主体、重要事实、直接影响和后续观察点；明确已确认事实与未决问题，避免无依据推测。"
  },
  blog: {
    label: "博客/AI Hero",
    description: "博客洞察：先判断文章类型，再按教程、工具评测、观点、案例复盘或产品介绍提炼。",
    focus: "先判断文章类型：教程、工具评测、观点、案例复盘或产品介绍；优先提炼作者核心观点、论证链、案例支撑、经验总结、可迁移方法和适用边界；教程保留步骤、prompt、配置、工具链、输入输出和限制；工具评测保留对象、标准、优缺点、适合/不适合场景；观点文保留论点、证据、反例、边界和不可验证主张。"
  },
  doc: {
    label: "文档精读",
    description: "优先目标、前置条件、步骤、接口、限制与示例。",
    focus: "优先保留目标、前置条件、关键步骤、接口/参数、限制、示例和注意事项；术语、API、配置名和顺序要准确。"
  },
  forum: {
    label: "论坛讨论",
    description: "问答归纳：优先楼主问题、讨论背景、约束条件、回复方案、共识、分歧、风险和可执行建议。",
    focus: "优先整理楼主问题、背景、约束、已尝试方案和明确诉求；标出关键约束；把回复归纳为候选方案、推荐答案、共识、分歧、争议点、风险、适用条件和可执行建议；一个评论不等于共识；高赞或重复出现只能表示社区倾向，不代表已验证事实；过滤玩笑、社交寒暄、签名、折叠内容和推荐噪音。"
  },
  repo: {
    label: "README 导读",
    description: "优先项目目标、安装方式、核心能力、使用路径与限制。",
    focus: "优先整理项目目标、安装方式、核心能力、使用路径、关键模块、约束、限制和适用场景。"
  },
  video: {
    label: "视频速览",
    description: "优先主题、时间线、教程步骤、案例、结论和复看线索。",
    focus: "优先整理视频主题、核心观点、关键事实、主题、时间线、教程步骤、案例、结论和复看线索；保留分段时间线和可复看片段；有时间戳时保留关键时间点；保留关键细节、例子、结论、建议、步骤和公式；教程/演示内容按步骤和决策整理；教程视频保留参数、设置、错误和注意事项；省略广告、填充词、问候语和无关言论；不要补充视频中没有的信息。"
  },
  "x-thread": {
    label: "X 推文/线程",
    description: "按推文、引用、回复和线程讨论处理。",
    focus: "识别主贴、引用上下文、回复、推荐内容和平台噪音；区分主贴、引用上下文、回复观点和平台推荐；保留核心主张、因果链、数字、工具、链接和可复用方法；回复按候选观点、共识、分歧、证据和风险归组；忽略推荐、广告、趋势和无关互动。"
  },
  "x-article": {
    label: "X 文章/长文",
    description: "按长文文章处理，保留论点、论证链、步骤、例子和资源。",
    focus: "按文章处理，不按回复链处理；保留中心论点、论证链、步骤、例子、工具、限制和结论；教程保留步骤、prompt、链接、输入输出和注意事项；资源列表保留分类、用途、链接和选择建议；评论只有在纠错或补充关键证据时才纳入。"
  },
  xiaohongshu: {
    label: "小红书笔记",
    description: "优先提炼笔记核心主张、清单/推荐、使用体验、效果对比、避坑点和选购建议。",
    focus: "先判断笔记类型：产品测评、经验教程、探店打卡、合集推荐或观点分享；产品测评保留对象、标准、效果、优缺点和价格；经验教程保留步骤、参数、工具、效果对比和注意事项；合集推荐保留分类标准、各条目理由、价格和推荐优先级；探店打卡保留地点、价格、环境、服务和推荐菜；省略个人日常、情绪表达、表情符号堆砌、话题标签和平台推广内容。"
  },
  weixin: {
    label: "微信公众号",
    description: "优先文章主旨、论证结构、关键证据、案例、数据和政策解读。",
    focus: "按长文文章处理：保留中心论点、论证链、案例数据、政策解读、限制和结论；涉及政策/官方文件时保留原文出处、文号、发布时间和适用范围；保留关键数据、图表结论、引用来源和延伸阅读；省略引导关注、赞赏、广告、评论区置顶和无关互动。"
  }
};

export function buildSummaryRequestPlan(
  source: SourcePayload,
  outputCompressionMode: OutputCompressionMode = "off",
  applyPruningMode = true
): SummaryRequestPlan {
  return {
    sourceContext: buildSourcePromptContext(source),
    lengthGuidance: buildLengthGuidance(source.text, outputCompressionMode, applyPruningMode),
    extractionStatus: buildExtractionStatusPrompt(source)
  };
}

function buildSourcePromptContext(source: SourcePayload): string {
  return [
    `标题：${source.title}`,
    `来源：${source.url}`,
    `来源类型：${source.sourceKind}`,
    `总结重点：${sourcePromptFocus(source)}`,
    buildBilibiliOfficialContext(source)
  ].filter(Boolean).join("\n");
}

function buildBilibiliOfficialContext(source: SourcePayload): string {
  if (source.sourceKind !== "bilibili-transcript" || !source.summaryHint) return "";
  return [
    "辅助信息：以下 Bilibili 官方 AI 总结只用于交叉参考；字幕原文是主要依据。两者冲突时以字幕原文为准，不要把官方分段大纲原样当成最终层级结构。",
    `Bilibili 官方参考：${JSON.stringify(source.summaryHint)}`
  ].join("\n");
}

function sourcePromptFocus(source: SourcePayload): string {
  if (source.sourceKind === "youtube-transcript") {
    return [
      "这是 YouTube 字幕内容。页面策略：视频速览。",
      SOURCE_STRATEGIES.video.focus,
      "省略广告、填充词、问候语和无关言论；字幕可能为自动生成，避免脑补缺失上下文。"
    ].join("");
  }
  if (source.sourceKind === "bilibili-official-summary") {
    return "这是 Bilibili 官方 AI 总结。页面策略：视频速览。直接基于官方总结和分段大纲组织，保留视频主题、关键事实、分段时间线和可复看片段，不额外推断视频未提供的信息。";
  }
  if (source.sourceKind === "bilibili-transcript" || source.sourceKind === "douyin-visible") {
    return [
      "这是视频字幕/可见文本。页面策略：视频速览。",
      SOURCE_STRATEGIES.video.focus,
      "省略广告、填充词、问候语和无关言论。"
    ].join("");
  }

  const strategy = resolveSourceStrategy(source);
  return `页面策略：${strategy.label}。策略说明：${strategy.description}${strategy.focus}`;
}

function resolveSourceStrategy(source: SourcePayload): SummarySourceStrategy {
  const haystack = `${source.url}\n${source.title}`.toLowerCase();
  const contentHaystack = `${source.url}\n${source.title}\n${source.text}`.toLowerCase();
  if (matchesAny(haystack, [/youtube\.com/, /youtu\.be/, /bilibili\.com\/video/, /b23\.tv/])) return SOURCE_STRATEGIES.video;
  if (/github\.com/i.test(source.url)) return SOURCE_STRATEGIES.repo;
  if (isXSource(haystack)) {
    return isXArticleSource(haystack, contentHaystack) ? SOURCE_STRATEGIES["x-article"] : SOURCE_STRATEGIES["x-thread"];
  }
  if (matchesAny(haystack, [
    /docs?/,
    /developer/,
    /api/,
    /reference/,
    /manual/,
    /guide/,
    /learn/
  ])) return SOURCE_STRATEGIES.doc;
  if (matchesAny(haystack, [/xiaohongshu\.com/])) return SOURCE_STRATEGIES.xiaohongshu;
  if (matchesAny(haystack, [/mp\.weixin\.qq\.com/])) return SOURCE_STRATEGIES.weixin;
  if (matchesAny(haystack, [
    /stackoverflow/,
    /stackexchange/,
    /reddit/,
    /linux\.do/,
    /segmentfault/,
    /v2ex/,
    /zhihu/,
    /quora/,
    /news\.ycombinator/,
    /\/questions?\//,
    /forum/,
    /community/,
    /discussion/,
    /discuss/
  ])) return SOURCE_STRATEGIES.forum;
  if (matchesAny(haystack, [
    /\/news\//,
    /news\./,
    /breaking/,
    /reuters/,
    /apnews/,
    /bbc\./,
    /cnn\./,
    /nytimes/,
    /theguardian/,
    /caixin/,
    /thepaper/,
    /36kr/
  ])) return SOURCE_STRATEGIES.news;
  if (matchesAny(haystack, [
    /\/blog\//,
    /blog\./,
    /medium\.com/,
    /martinfowler\.com/,
    /substack\.com/,
    /dev\.to/,
    /ai[-.]?hero/,
    /hashnode/,
    /wordpress/,
    /ghost\.io/
  ])) return SOURCE_STRATEGIES.blog;
  return SOURCE_STRATEGIES.generic;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isXSource(haystack: string): boolean {
  return matchesAny(haystack, [/(^|\/\/)(www\.)?x\.com\//, /(^|\/\/)(www\.)?twitter\.com\//]);
}

function isXArticleSource(haystack: string, contentHaystack: string): boolean {
  if (matchesAny(haystack, [/\/i\/articles?\//, /\/articles?\//])) return true;
  if (matchesAny(haystack, [/\/status\//])) return false;
  return matchesAny(contentHaystack, [
    /^#{1,3}\s+/m,
    /资源列表/,
    /工具链/,
    /教程/,
    /步骤[一二三四五六七八九十\d]/,
    /输入输出/,
    /long-form/
  ]);
}

export function buildSummaryLengthBudgetGuidance(mode: OutputCompressionMode): string {
  const maxVisibleChars: Record<OutputCompressionMode, number> = { off: 1600, lite: 1000, full: 600, ultra: 300 };
  const target = maxVisibleChars[mode];
  return [
    `最终摘要总篇幅目标：约 ${target} 个可见字符以内。`,
    "概览、标题与全部层级要点的可见文字合计；仅排除 JSON/JSONL 结构标记。此目标是软上限，不是字数下限。",
    "超出预算时先合并重复内容，再删弱例子、铺垫和旁支；用最短准确表述保留核心结论、理解主线必需的事实与关键证据。",
    "不得截断句子。数字与单位、否定与限定条件、因果链、出处与链接、错误原文与技术标识符优先保留；必要事实本身超过预算时，允许有限超出。"
  ].join("\n");
}

function buildLengthGuidance(
  text: string,
  outputCompressionMode: OutputCompressionMode = "off",
  applyPruningMode = true
): string {
  const length = text.trim().length;
  const compression = applyPruningMode ? summaryCompressionUserGuidance(outputCompressionMode) : "";
  const appendDensityAndCompression = (guidance: string) => [
    guidance,
    ...(applyPruningMode ? [buildSummaryLengthBudgetGuidance(outputCompressionMode)] : []),
    applyPruningMode ? buildDensityBudgetGuidance() : buildIntermediateDensityGuidance(),
    compression
  ].filter(Boolean).join("\n");
  // 原文长度只描述输入规模；最终摘要篇幅由档位预算约束。
  if (length < 1200) {
    return appendDensityAndCompression(`内容长度约 ${length} 字符，属于短内容：按取舍档位选内容，不因篇幅短就跳过该保留的要点。`);
  }
  if (length < 6000) {
    return appendDensityAndCompression(`内容长度约 ${length} 字符，属于中等内容：按取舍档位选内容与层级深度。`);
  }
  if (length < 16000) {
    return appendDensityAndCompression(`内容长度约 ${length} 字符，属于长内容：篇幅不构成扩充理由，取舍以档位为准；保留项仍要写具体。`);
  }
  return appendDensityAndCompression(`内容长度约 ${length} 字符，属于超长内容：篇幅不构成扩充理由，取舍以档位为准；保留项的层级与细节仍要写具体。`);
}

function buildIntermediateDensityGuidance(): string {
  return "本段中间提炼供最终合成使用；保留本段关键事实，不套用最终展示篇幅预算。";
}

function buildDensityBudgetGuidance(): string {
  return [
    "最终摘要长度以摘要详细程度的总篇幅目标为先；有效信息量决定目标内的取舍顺序。",
    "短文本如果包含密集步骤、代码、参数、争议或工具链，优先保留预算内最有价值的细节；确有理解需要时允许有限超出。",
    "长文本如果大量重复、寒暄、广告或无关评论，必须压缩。"
  ].join("\n");
}

function buildExtractionStatusPrompt(source: SourcePayload): string {
  if (!source.extractionDiagnostics?.lowConfidence) return "";
  return [
    "## 抽取状态",
    "正文抽取置信度偏低；可能包含导航、缺正文或内容残缺。",
    "如果输入不足，请在 overview 中说明“可用正文不足”，不要根据标题或常识补全。"
  ].join("\n");
}

// 最终摘要请求在 user 侧重复档位摘要，让当前选择贴近原文与篇幅预算。
function summaryCompressionUserGuidance(mode: OutputCompressionMode): string {
  switch (mode) {
    case "lite":
      return "当前取舍档位：标准。尽量保留论证骨架与主要独立观点；篇幅紧张时压缩表达并删次要观点。";
    case "full":
      return "当前取舍档位：精简。只保留理解所必需的内容；同义观点合并，先删弱例子、铺垫与旁支。";
    case "ultra":
      return "当前取舍档位：极简。只留核心结论、关键证据、必要动作与关键数字；允许整节删除。";
    default:
      return "";
  }
}
