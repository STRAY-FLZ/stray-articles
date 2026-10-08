export const DEMO_RECORDS = [
  {
    word: "record",
    ipaUS: "/ˈrekərd/（名词）；/rɪˈkɔːrd/（动词）",
    examTags: ["CET-4", "CET-6"],
    senses: [
      {
        partOfSpeech: "noun",
        definitionEN: "information kept for later use",
        definitionZH: "供以后使用而保存的记录",
        dictionarySource: "原创教学演示（非词典原文）",
        dictionaryVersion: "演示 v1",
        examples: [
          {
            sentence: "Keep a record of your reading.",
            exampleTranslation: "记录你的阅读情况。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
      {
        partOfSpeech: "verb",
        definitionEN: "to save sound or information",
        definitionZH: "录制声音或记录信息",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "We record our weekly discussion.",
            exampleTranslation: "我们录下每周的讨论。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
    ],
  },
  {
    word: "light",
    ipaUS: "/laɪt/",
    examTags: ["CET-4", "IELTS"],
    senses: [
      {
        partOfSpeech: "noun",
        definitionEN: "brightness that makes things visible",
        definitionZH: "使物体可见的光",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "Light enters through the window.",
            exampleTranslation: "光从窗户照进来。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
      {
        partOfSpeech: "adjective",
        definitionEN: "having little weight",
        definitionZH: "重量轻的",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "This bag is light.",
            exampleTranslation: "这个包很轻。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
    ],
  },
  {
    word: "adapt",
    ipaUS: "/əˈdæpt/",
    examTags: ["CET-6", "IELTS"],
    senses: [
      {
        partOfSpeech: "verb",
        definitionEN: "to change to suit new conditions",
        definitionZH: "调整以适应新的条件",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "Plants adapt to their environment.",
            exampleTranslation: "植物适应其环境。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
    ],
  },
  {
    word: "river",
    ipaUS: "/ˈrɪvər/",
    examTags: ["CET-4", "CET-6", "IELTS"],
    senses: [
      {
        partOfSpeech: "noun",
        definitionEN: "a natural stream of water flowing across land",
        definitionZH: "流经陆地的天然水流；河流",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "The river runs through our town.",
            exampleTranslation: "这条河流经我们的镇子。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
    ],
  },
  {
    word: "heavy",
    ipaUS: "/ˈhevi/",
    examTags: ["CET-4", "CET-6", "IELTS"],
    senses: [
      {
        partOfSpeech: "adjective",
        definitionEN: "having a great weight",
        definitionZH: "重量大的；沉重的",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "The box is heavy.",
            exampleTranslation: "这个箱子很重。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
    ],
  },
  {
    word: "observe",
    ipaUS: "/əbˈzɜːrv/",
    examTags: ["CET-4", "CET-6", "IELTS"],
    senses: [
      {
        partOfSpeech: "verb",
        definitionEN: "to watch carefully",
        definitionZH: "仔细观察",
        dictionarySource: "原创教学演示（非词典原文）",
        examples: [
          {
            sentence: "Observe the leaves carefully.",
            exampleTranslation: "仔细观察叶子。",
            exampleSource: "原创教学演示",
            sourceType: "original",
          },
        ],
      },
    ],
  },
];
export const DEMO_TEXT = DEMO_RECORDS.map((x) => JSON.stringify(x)).join("\n");
export const EXPORT_SPEC =
  `请将我提供的词汇导出为 UTF-8 JSON Lines，每行一个完整 JSON 对象，保存为 .txt。不要添加 Markdown 围栏、解释或逗号分隔的多行对象。\n必需：word；senses 数组；每个词义的 partOfSpeech、definitionEN、definitionZH。\n建议提供：ipaUS（美式）、examTags（CET-4/CET-6/IELTS 或自定义）、homographKey（需要区分同形异源词时）、sourceMetadata。\n每个 sense 支持 senseId（原始来源标识）、dictionarySource、dictionaryVersion、examples、senseFrequency、semanticCategory、synonyms、highPriority。\n每个 examples 元素：sentence、exampleTranslation、exampleSource、sourceType（exam/news/dictionary/original）、exam（如适用）。\n同一个 sense 只放一个相对应的英文释义和中文释义，并注明本词义的词性；例句必须属于该词义。不同词性和词义分别放入 senses 数组，不拼接不对应的释义。\n优先使用合法提供的 Oxford Advanced Learner's Dictionary 第 10 版、Cambridge、Collins 资料。必须准确保留实际来源及版本；没有资料的字段留空，不编造音标、词典原文、考试年份、语料数量或例句来源。AI 或原创例句必须明确标注。\n词义频率仅接受真实的 senseFrequency，例如 CET-4:{level:"sense",count:实际次数,sampleSize:实际语料样本量,source:实际来源,corpusId:语料标识,methodology:标注方法,measurement:统计单位,reliable:true}。不要用整词频率代替词义频率；无法验证则不填。\nhighPriority 仅用于用户明确提供的高优先级标注，不代表已知考试频率。\n以下全部是原创教学演示数据，非真实词典原文或考试题目：\n` +
  DEMO_RECORDS.slice(0, 3)
    .map((x) => JSON.stringify(x))
    .join("\n");
