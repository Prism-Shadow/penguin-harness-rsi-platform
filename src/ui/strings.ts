/**
 * The workbench page's words, one table per interface language. The frame reads the language off
 * its root element (`lang`, which the host writes and keeps current), so the page picks a table
 * at render time and never translates anything itself.
 *
 * `en` is typed as `Strings`, the shape of `zh`: the compiler refuses a key one table has and the
 * other lacks. The wording comes from the Web App's Evaluation Center dictionaries; what changed
 * with the move is the app's name and the forms' one exit, which now starts the task at once.
 * The prompts themselves are written by the server (src/server/prompts.ts), in the language the
 * request names.
 */
import type { UiStrings } from "@prismshadow/penguin-ui";
import type { ApprovalMode, TaskState, WorkbenchTaskKind } from "../api";

/** The UI package's own words (close crosses, pagers, the Markdown reader), less the A2UI set this page never draws. */
type PageUiStrings = Omit<UiStrings, "a2ui">;

const zhUi: PageUiStrings = {
  close: "关闭",
  copied: "已复制",
  loading: "加载中…",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  clearSearch: "清除搜索",
  moreInfo: "说明",
  moreInfoAbout: (subject: string) => `说明：${subject}`,
  notifications: "通知",
  dismiss: "关闭",
  copyCode: "复制代码",
  expand: "展开",
  collapse: "折叠",
  more: "更多",
  fewer: "收起",
  previous: "上一页",
  next: "下一页",
  pagePosition: (page: number, pageCount: number) => `第 ${page} 页，共 ${pageCount} 页`,
  reader: {
    outline: "目录",
    find: "在文档中查找",
    findPlaceholder: "在文档中查找…",
    previousMatch: "上一个",
    nextMatch: "下一个",
    closeFind: "关闭",
    noResults: "无结果",
  },
};

const enUi: PageUiStrings = {
  close: "Close",
  copied: "Copied",
  loading: "Loading…",
  showPassword: "Show password",
  hidePassword: "Hide password",
  clearSearch: "Clear search",
  moreInfo: "More info",
  moreInfoAbout: (subject: string) => `More info: ${subject}`,
  notifications: "Notifications",
  dismiss: "Dismiss",
  copyCode: "Copy code",
  expand: "Expand",
  collapse: "Collapse",
  more: "More",
  fewer: "Show less",
  previous: "Previous page",
  next: "Next page",
  pagePosition: (page: number, pageCount: number) => `Page ${page} of ${pageCount}`,
  reader: {
    outline: "Outline",
    find: "Find in document",
    findPlaceholder: "Find in document…",
    previousMatch: "Previous match",
    nextMatch: "Next match",
    closeFind: "Close",
    noResults: "No results",
  },
};

const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const zh = {
  /** The app's name: the page heading. */
  appTitle: "自进化工作台",
  ui: zhUi,
  common: {
    cancel: "取消",
    close: "关闭",
    delete: "删除",
    loading: "加载中…",
    saving: "保存中…",
    time: "时间",
    cost: "成本",
    requiredField: "此项必填",
    unknownError: "请求失败，请稍后重试",
    networkError: "无法连接服务器，请检查网络后重试",
    retry: "重试",
    /** The prompt every way of leaving a form with unsaved edits shows. */
    discardTitle: "放弃未保存的修改",
    discardBody: "放弃未保存的修改？未保存的内容将丢失。",
    discard: "放弃修改",
    keepEditing: "继续编辑",
  },
  /** How long ago, for a narrow row: minutes, hours and days, then the month and day. */
  relative: {
    now: "刚刚",
    minutes: (n: number): string => `${n} 分钟前`,
    hours: (n: number): string => `${n} 小时前`,
    days: (n: number): string => `${n} 天前`,
    monthDay: (month: number, day: number): string => `${month}月${day}日`,
  },
  machines: {
    onMachine: (name: string, machine: string): string => `${name} [SSH: ${machine}]`,
    machineTag: (machine: string): string => `[SSH: ${machine}]`,
    /** The quiet line above the list when a machine did not answer the merged read. */
    unreachable: (labels: string): string => `这些机器没有应答，它们上的副本暂未列出：${labels}`,
  },
  files: {
    treeLabel: "文件树",
    empty: "空目录",
    previewTruncated: "内容过大，预览已截断，请下载查看完整文件",
    previewUnsupported: "该类型不支持预览，请下载查看",
    download: "下载",
  },
  semanticId: {
    generateIdLabel: "用 AI 生成",
    generateId: "从名称生成 ID",
    idSuggest: {
      fromName: "按名称转写生成",
      placeholder: (reason: string): string =>
        `模型没有给出可用的 ID（${reason}），已填入占位 ID，请改成有含义的英文名`,
      reasons: {
        no_default_model: "未配置默认模型",
        model_failed: "模型调用失败",
        unusable_answer: "模型回答不可用",
        no_ascii: "名称里没有可转写的英文",
      } as Record<string, string>,
      reasonUnknown: "原因未知",
    },
  },
  /** The start forms' shared parts: who does the work, the examples, the prompt fold, the one exit. */
  form: {
    withAi: "用 AI 创建",
    manual: "手动创建",
    start: "开始",
    starting: "正在开始…",
    copyPrompt: "复制提示词",
    examplesTitle: "试试这些示例",
    fullPrompt: "完整提示词",
    previewLoading: "正在生成提示词…",
    previewUnavailable: "暂时无法预览提示词",
    /** Who does the work, and where: the form's lead line. */
    byAgent: (name: string): string => `将由「${name}」在新对话中完成`,
    placeholder: "描述你想要什么，越具体越好",
    promptLabel: "提示词",
    noAgent: "当前 Project 还没有智能体",
    approvalMode: "审批模式",
    approvalModeHint: "这个对话里工具调用的审批方式；命令策略要求询问的步骤仍会等待审批",
    approvalModes: {
      "allow-all": "全部放行",
      "deny-all": "全部拒绝",
      "read-only": "放行只读",
      "always-ask": "总是询问",
    } satisfies Record<ApprovalMode, string>,
    modelsEmpty: "尚未配置任何模型",
  },
  /** The tasks the page started, and what a start says. */
  tasks: {
    title: "任务",
    /** The list page's section: the create and import tasks, which belong to no Benchmark. */
    recentTitle: "创建与导入任务",
    kinds: {
      create: "创建",
      import: "导入",
      evaluate: "评估",
      optimize: "优化",
      ask: "问 AI",
    } satisfies Record<WorkbenchTaskKind, string>,
    states: {
      running: "进行中",
      waiting: "等待审批",
      done: "已结束",
      failed: "失败",
      gone: "已删除",
    } satisfies Record<TaskState, string>,
    pendingApprovals: (n: number): string => `${n} 个步骤等待审批`,
    openChat: "打开对话",
    started: (kind: string): string => `已开始「${kind}」：对话已出现在你的侧栏中。`,
    dismiss: "关闭",
    skillMissing: (skill: string, plugin: string): string =>
      `执行的智能体没有 ${skill} 技能。为它安装 ${plugin} 插件后，再按「开始」。`,
    install: "安装",
    installed: (plugin: string): string => `已安装 ${plugin}，请再按「开始」。`,
  },
  errors: {
    byCode: {
      benchmark_busy:
        "这个 Benchmark 正在评估：它的 .jobs/ 里还有没跑完的运行，现在覆盖，进行中的评估会接着写进新导入的副本。请等评估结束后再覆盖。",
    } as Record<string, string>,
  },
  benchmark: {
    /** The three step cards under the title: each says where on this page to do that step. */
    guideFlow: [
      {
        title: "出题",
        text: "点右上角「用 AI 创建」，让 AI 为某个智能体出一套题并取得基线分；也可以「手动创建」自己写题。",
      },
      {
        title: "评估",
        text: "选一个 Benchmark，点「使用」→「评估」，选好被测智能体后按「开始」，即得到一条带标签的分数。",
      },
      {
        title: "优化",
        text: "选一个 Benchmark，点「使用」→「优化」，设定目标分数后按「开始」；分数严格提升才保留新版本，也可以换一种自进化算法。",
      },
    ],
    /** The first step card's text for a Project member: no Create manually, which is the owner's. */
    guideCreateMember: "点右上角「用 AI 创建」，让 AI 为某个智能体出一套题并取得基线分。",
    searchPlaceholder: "搜索标题、描述或被测智能体",
    noMatches: "没有匹配的 Benchmark",
    filterByAgent: (agentId: string): string => `只看评测过 ${agentId} 的 Benchmark`,
    clearFilter: "显示全部",
    emptyTitle: "还没有 Benchmark",
    emptyDescription:
      "先让 AI 为一个智能体出题并取得基线分；之后这里会显示分数曲线与逐题明细，并可一键发起优化。",
    caseCount: (n: number): string => `${n} 题`,
    runsPerCase: (n: number): string => `每题 ${n} 次运行`,
    notEvaluated: "尚未评测",
    building: "构建中",
    buildingHint: "智能体还在出题与校准难度，构建完成后即可使用",
    buildingDetail: "构建完成后，这里会显示题目、分数曲线与评估明细。",
    creationFailed: "创建失败",
    creationFailedHint: "题目难度未能校准完成，请删除后重新创建",
    creationFailedDetail:
      "这套题的难度校准没有完成，无法评估或优化；请删除这个 Benchmark，然后重新创建。",
    creationFailedHintMember: "题目难度未能校准完成",
    creationFailedDetailMember: "这套题的难度校准没有完成，无法评估或优化。",
    testedAgents: "被测过的智能体",
    lastEvaluated: (when: string): string => `最近评估 ${when}`,
    sparklineLabel: (n: number): string => `${n} 次评估的分数走势`,
    latestScoreLabel: "最新分数",
    firstEvaluation: "首次评估",
    use: "使用",
    evaluate: "评估",
    optimize: "优化",
    view: "查看",
    copyPath: "复制目录路径",
    versionLabel: "版本",
    sourceLabel: "来源",
    manifestBroken: "清单无法读取",
    manifestBrokenHint: "修好它的 benchmark_config.toml 即可使用，也可以删除它",
    manifestBrokenHintMember: "修好它的 benchmark_config.toml 后即可使用",
    manifestBrokenDetail: (hint: string, reason: string): string => `${hint}。原因：${reason}`,
    deleteBenchmark: "删除 Benchmark",
    deleteConfirm: (title: string): string =>
      `确定删除「${title}」吗？它的全部题目与评估记录都会被删除，无法恢复。`,
    deleted: "Benchmark 已删除",
    backToList: "返回列表",
    notFound: "找不到这个 Benchmark",
    notFoundHint: "它可能已被删除，或者链接里的 id 不对。",
    trendTitle: (metric: string): string => `${metric}随时间变化`,
    cases: "题目",
    viewCase: "查看详情",
    taskMaterials: "任务材料",
    rubric: "评分标准",
    agentHidden: "被测 Agent 不可见",
    caseFileUnavailable: "案例文件暂时无法读取",
    evaluations: "评估明细",
    noEvaluations: "暂无评估记录",
    noEvaluationsHint: "取得基线分后，这里会出现分数曲线与评估明细。",
    summaryLabel: "评估说明",
    unlabeled: "未标注",
    agentColumn: "被测 Agent",
    colVersion: "版本",
    colModel: "模型 ID",
    colThinkingLevel: "推理强度",
    colScore: "分数",
    colDuration: "耗时",
    colCase: "题目",
    colRun: "运行",
    runOpenSession: "打开这次运行的会话",
    /** A run link whose Session no longer exists. */
    runSessionGone: "这次运行的会话已不存在",
    copyTrialName: "复制 Harbor trial 名称",
    askAi: "问 AI",
    evaluationDetailTitle: (time: string): string => `评估 · ${time}`,
    askEvaluationTitle: "问 AI：这次评估",
    askEvaluationDescription:
      "这次评估的总分、逐题结果与逐次运行的 Session id 会一起交给智能体，它读过记分板与相关 Trace 后作答；问题可以改。",
    askEvaluationExamples: {
      explain: {
        label: "解释这次评估的结果",
        prompt: "解释这次评估的结果。",
      },
      whyLow: {
        label: "为什么这次分数低？",
        prompt: "为什么这次评估的分数偏低？请结合逐题分数与运行记录说明主要失分在哪里。",
      },
      weakest: {
        label: "哪些题最弱、该改什么？",
        prompt: "哪几道题分数最低？分别是什么原因，被测智能体改哪一处才有机会提上去？",
      },
      againstPrevious: {
        label: "与上一次评估相比变化在哪？",
        prompt: "与这个系列上一次评估相比，哪些题涨了、哪些题掉了？这些变化最可能来自什么？",
      },
    },
    askCaseTitle: "问 AI：这道题",
    askCaseDescription:
      "题干与评分细则的路径会交给智能体，请它讲清这道题考什么、怎样才算答好；题目已冻结，它只读不改。",
    askCaseExamples: {
      explain: {
        label: "解释这道题考什么、怎样才算答好",
        prompt: "解释这道题考什么、怎样才算答好。",
      },
      rubricRewards: {
        label: "评分细则在奖励什么？",
        prompt: "这道题的评分细则把分数主要放在哪些地方？哪些条目最能把优秀与及格区分开？",
      },
      whyRunLow: {
        label: "为什么有的运行在这道题上分数低？",
        prompt: "最近一次评估在这道题上分数不高，可能是被测智能体在哪一步做丢了？",
      },
      clearerStatement: {
        label: "题干怎样才能更清楚？",
        prompt:
          "这道题的题干有没有含糊或容易误读的地方？题目已冻结不能改，请说明如果下次新建 Benchmark 该怎么写得更清楚。",
      },
    },
    aiCreateTitle: "让 AI 创建 Benchmark",
    aiCreateDescription:
      "描述要考察的能力与场景，AI 会为被测智能体出题、逐题试测以校准难度，并取得基线分。",
    targetAgent: "被测智能体",
    targetAgentHint: "题目为它而出、分数记在它名下；出题本身由下方所示的智能体在新对话里完成",
    aiCreateExamples: {
      decisionAgent: {
        label: "决策：足球、售后与投资的有限选择",
        description: "公开规则、历史案例与当前事实互相冲突或不完整",
        prompt:
          "为通用决策智能体出题：足球投注、售后处置、投资动作三个场景，各给一组有限选项，公开规则、历史案例与当前事实要么不完整、要么互相冲突，看它能不能给出稳定、可解释的选择，而不是被最近的一条信息带着走。",
      },
      reportWriter: {
        label: "报告写作：材料互相矛盾",
        description: "冲突材料、缺失口径、严格的篇幅与引用",
        prompt:
          "为报告写作智能体出题：材料互相矛盾，币种、时区这类关键口径故意不写全，篇幅和引用格式卡得很严，看它会不会先指出缺口、再做保守假设。",
      },
      customerService: {
        label: "客服：隐藏政策前提的对话题",
        description: "信息不全的用户、藏在附录的政策条件、越权承诺陷阱",
        prompt:
          "为客服智能体出多轮对话题：用户描述模糊、关键事实要追问才给，政策的例外条款藏在附录里，情绪化的表达在诱导越权承诺，看它会不会先核实再答复、守住政策口径。",
      },
      codeReview: {
        label: "代码审查：缺陷藏在约定里",
        description: "未写明的调用与并发前提，误导人的注释与测试",
        prompt:
          "为代码审查智能体出题：每题一个小型多文件仓库，缺陷藏在没写明的调用顺序、时区或编码假设和并发前提里，再配上过时的注释和一份能通过却盖不住缺陷的测试，看它查全、误报和验证步骤。",
      },
    },
    manualCreateTitle: "手动创建 Benchmark",
    manualCreateIntro:
      "填好标题、题干与评分细则后，目录结构会按技能约定写入自进化工作台的数据目录；Benchmark 与 Agent 平级，之后可以用它评测任意智能体。",
    idField: "Benchmark id",
    idHint: "目录名即标识：仅字母、数字、_ 和 -，例如 report-writing-v1",
    idGenerateHint: "；也可以从标题生成",
    idExists: "已有同名 Benchmark，请换一个 id",
    titleField: "标题",
    descriptionField: "描述",
    descriptionHint: "一句话说明考察什么能力、题目难在哪里",
    runsField: "每题运行次数",
    runsHint: "1–1000 的整数；优化时每道题跑这么多次取平均",
    runsInfo:
      "多次运行能把稳定的能力差距和偶然波动分开，但评测成本按次数倍增。AI 出题校准时固定每题 1 次；这里的值给之后的优化用。",
    casesTitle: "题目",
    casesInfo:
      "每道题分两部分：题干交给被测智能体；评分细则只有评测方能看到，永远不进被测智能体的 Workspace。",
    rubricInfo:
      "有区分度的评分细则：条目可观察、合计 100 分，把分数主要放在「真正做对」和「看起来做对」会产生不同结果的决定或产物上，不要给格式合规太高的保底分。",
    caseHeading: (n: number): string => `第 ${n} 题`,
    caseSlugField: "目录名后缀",
    caseSlugHint: (id: string): string => `目录名 ${id}：仅字母、数字、_ 和 -`,
    caseTitleField: "题目标题",
    caseStatementField: "题干",
    caseStatementHint: "Markdown；写明目标、给定材料、要求的产物与格式，不要暗示解法或评分点",
    caseRubricField: "评分细则",
    caseRubricHint: "Markdown；逐条给分并合计 100 分，如「- 40 分：……」",
    addCase: "添加题目",
    removeCase: "删除此题",
    createSubmit: "创建 Benchmark",
    created: "Benchmark 已创建",
    invalidId: "仅允许字母、数字、_ 和 -",
    invalidRuns: "必须是 1–1000 的整数",
    invalidScore: "必须是 1–100 的整数",
    useTitle: (title: string): string => `使用：${title}`,
    testedAgent: "被测智能体",
    evaluateDescription:
      "AI 会把被测智能体放到这套 Benchmark 上跑完整的 Case × runs 矩阵，并把结果作为一条带标签的评估追加进记分。",
    evaluateTestedAgentHint:
      "评估的是它当下的 Agent State；分数记在它名下，标签含其版本号、模型与思考等级",
    evaluatorAgent: "执行评估的智能体",
    evaluatorAgentHint:
      "派发评测子会话、按评分细则打分并写入记分的一方；需要装有 agent-evaluation 技能",
    evaluatorMissingSkill:
      "该智能体没有安装 agent-evaluation 技能，多半无法完成评估——建议换用默认智能体；按「开始」后也可以为它安装所需的插件。",
    evaluateSessionModel: "评估会话使用的模型",
    evaluateSessionModelHint:
      "这个会话运行所用的模型，缺省为 Project 默认模型；它负责派发、打分与记录，不是被测的模型",
    testedModel: "被测智能体使用的模型",
    testedModelHint:
      "被测智能体每次测试都用这个模型，思考等级沿用它自己的配置；预设为它在这套 Benchmark 上最近一次评估所用的模型，没有时为 Project 默认模型",
    evaluateRunsHint: "每道题跑几次取平均；缺省为 Benchmark 配置的次数",
    evaluateNoteField: "说明",
    evaluateNotePlaceholder: "例如：这一轮用来确认上次优化的效果，重点看引用规范那两道题",
    optimizeDescription: "AI 会按可证伪的假设修改被测智能体并重新评测，分数严格提升才保留新版本。",
    optimizerAgent: "执行优化的智能体",
    optimizerAgentHint: "读分数与 Trace、修改被测智能体的一方；需要装有 agent-optimization 技能",
    optimizerMissingSkill:
      "该智能体没有安装 agent-optimization 技能，多半无法完成优化——建议换用默认智能体；按「开始」后也可以为它安装所需的插件。",
    testedAgentHint: "优化改的是它的 Agent State；分数记在它名下，只与它自己同标签的历史分数比较",
    sessionModel: "优化会话使用的模型",
    sessionModelHint: "运行方法、读结果并做改动的模型，缺省为 Project 默认模型；它不是被测的模型",
    optimizeRunsHint: "每个候选版本每道题跑几次取平均",
    roundLimitField: "最多轮数",
    roundLimitHint: "每轮一个改动；评测完整才算一轮",
    targetScoreField: "目标分数",
    targetScoreHint: "达到即提前结束；默认比当前基线高 10 分",
    focusField: "优化重点",
    focusPlaceholder: "例如：重点优化引用规范与格式合规，不要改动写作风格",
    noBaseline:
      "所选被测智能体在这套 Benchmark 上还没有这个模型的基线分。优化需要一条完整的基线评估作为比较起点——先到「评估」用同一个模型跑一次完整评测取得基线。",
    baselineLine: (score: string, target: number): string => `当前基线 ${score} · 目标 ${target}`,
    methodField: "方法",
    methodHint:
      "改进智能体所用的自进化算法：插件库「Agent 自进化」分类里的每个工具包各是一种，在插件市场安装后即出现在这里",
    methodsNone: "插件库里没有自进化算法工具包，按默认循环优化",
    methodBudgetHint:
      "这个方法按它自己的技能运行：在哪些数据上训练和测试、预算多少，都由技能决定，除非在「优化重点」里另行指定",
    testRepetitionsField: "测试集重复次数",
    testRepetitionsHint: "报告的每个 State（基线与最终版本）在测试集上完整测几次",
    methodOptimizerHint: (skill: string): string =>
      `运行该方法、修改被测智能体的一方；需要装有 ${skill} 技能`,
    methodMissingSkill: (plugin: string, skill: string): string =>
      `该智能体没有安装 ${skill} 技能，无法运行这个方法——换用默认智能体，或按「开始」后为它安装 ${plugin} 插件。`,
    importBenchmark: "导入评估集",
    importChatTitle: "让 Agent 导入",
    importChatWhy: "Agent 读取来源后，将评估集文件复制到本 Project；按「开始」即在新对话中进行。",
    importSourceLabel: "评估集来源",
    importSourceHint: "仓库文件夹链接、本地路径或描述",
    importSourcePlaceholder: "粘贴来源，或选择下方示例",
    importExamples: [
      {
        key: "penguinharness-benchmark-sec-a",
        label: "Sec A · 数据分析",
        description: "Data Analysis Bench 子集",
      },
      {
        key: "penguinharness-benchmark-sec-b",
        label: "Sec B · 软件工程",
        description: "DeepSWE v1.1 子集",
      },
      {
        key: "penguinharness-benchmark-sec-c",
        label: "Sec C · 自动化",
        description: "AutomationBench 子集",
      },
      {
        key: "penguinharness-benchmark-sec-e",
        label: "Sec E · 终端任务",
        description: "Terminal-Bench 4.0 CPU 子集",
      },
    ],
    /** What the prompt preview names in place of the source until one is entered. */
    importSourceToken: "<来源>",
    importUploadTitle: "上传 zip",
    importUploadDesc: "包含 benchmark_config.toml 和 CASE-*/，可置于同一个顶层目录内。",
    importUploadInfo: "可直接上传自进化工作台导出的 zip。只导入题目，评估记录从空开始。",
    importUploadAction: "选择 zip 文件",
    importUploading: "上传中…",
    importDoneToast: "Benchmark 已导入",
    importOverwriteTitle: "覆盖已有的 Benchmark",
    importOverwriteBody: (id: string): string =>
      `Benchmark「${id}」已存在。覆盖会替换它的全部文件，已有的评估记录（scoreboard）与运行结果将一并删除，且不可撤销。继续？`,
    importOverwriteAction: "覆盖导入",
    exportBenchmark: "导出",
  },
};

/** The tables' shape: every key in one is in the other. */
export type Strings = typeof zh;

export const en: Strings = {
  appTitle: "Self-Evolution Workbench",
  ui: enUi,
  common: {
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    loading: "Loading…",
    saving: "Saving…",
    time: "Time",
    cost: "Cost",
    requiredField: "This field is required",
    unknownError: "Request failed, please try again later",
    networkError: "Could not reach the server; check the network and try again",
    retry: "Retry",
    discardTitle: "Discard unsaved changes",
    discardBody: "Discard unsaved changes? What you typed will be lost.",
    discard: "Discard changes",
    keepEditing: "Keep editing",
  },
  relative: {
    now: "now",
    minutes: (n: number): string => `${n}m`,
    hours: (n: number): string => `${n}h`,
    days: (n: number): string => `${n}d`,
    monthDay: (month: number, day: number): string => `${EN_MONTHS[month - 1] ?? month} ${day}`,
  },
  machines: {
    onMachine: (name: string, machine: string): string => `${name} [SSH: ${machine}]`,
    machineTag: (machine: string): string => `[SSH: ${machine}]`,
    unreachable: (labels: string): string =>
      `These machines did not answer, so their copies are not listed yet: ${labels}`,
  },
  files: {
    treeLabel: "File tree",
    empty: "Empty directory",
    previewTruncated: "File too large; preview truncated, download for the full file",
    previewUnsupported: "Preview not supported for this type; download instead",
    download: "Download",
  },
  semanticId: {
    generateIdLabel: "Generate with AI",
    generateId: "Generate an id from the name",
    idSuggest: {
      fromName: "Transliterated from the name",
      placeholder: (reason: string): string =>
        `The model gave no usable id (${reason}); a placeholder was filled in — please change it to something meaningful`,
      reasons: {
        no_default_model: "no default model configured",
        model_failed: "the model request failed",
        unusable_answer: "the model's answer was unusable",
        no_ascii: "the name carries no ASCII to transliterate",
      },
      reasonUnknown: "reason unknown",
    },
  },
  form: {
    withAi: "Create with AI",
    manual: "Create manually",
    start: "Start",
    starting: "Starting…",
    copyPrompt: "Copy prompt",
    examplesTitle: "Try an example",
    fullPrompt: "Full prompt",
    previewLoading: "Writing the prompt…",
    previewUnavailable: "The prompt cannot be previewed right now",
    byAgent: (name: string): string => `Done by ${name} in a new conversation`,
    placeholder: "Describe what you want — the more specific, the better",
    promptLabel: "Prompt",
    noAgent: "This Project has no agent yet",
    approvalMode: "Approval mode",
    approvalModeHint:
      "How tool calls in this conversation are approved; a step the command policy asks about still waits for approval",
    approvalModes: {
      "allow-all": "Approve everything",
      "deny-all": "Deny everything",
      "read-only": "Approve read-only",
      "always-ask": "Ask every time",
    },
    modelsEmpty: "No models configured yet",
  },
  tasks: {
    title: "Tasks",
    recentTitle: "Create and import tasks",
    kinds: {
      create: "Create",
      import: "Import",
      evaluate: "Evaluate",
      optimize: "Optimize",
      ask: "Ask AI",
    },
    states: {
      running: "Running",
      waiting: "Waiting for approval",
      done: "Done",
      failed: "Failed",
      gone: "Deleted",
    },
    pendingApprovals: (n: number): string => `${n} step${n === 1 ? "" : "s"} waiting for approval`,
    openChat: "Open chat",
    started: (kind: string): string => `Started: ${kind}. The conversation is in your sidebar.`,
    dismiss: "Dismiss",
    skillMissing: (skill: string, plugin: string): string =>
      `The agent doing the work has no ${skill} Skill. Install the ${plugin} plugin on it, then press Start again.`,
    install: "Install",
    installed: (plugin: string): string => `${plugin} is installed; press Start again.`,
  },
  errors: {
    byCode: {
      benchmark_busy:
        "This Benchmark is being evaluated: a run under its .jobs/ has not finished, and overwriting it now would let that evaluation go on writing into the new copy. Overwrite it once the evaluation ends.",
    },
  },
  benchmark: {
    guideFlow: [
      {
        title: "Create",
        text: "Press Create with AI at the top right to have AI write a set of cases for an agent and take its baseline score, or Create manually to write the cases yourself.",
      },
      {
        title: "Evaluate",
        text: "Pick a Benchmark, press Use → Evaluate, choose the agent under test and press Start to get one labelled score.",
      },
      {
        title: "Optimize",
        text: "Pick a Benchmark, press Use → Optimize, set a target score and press Start; a new version is kept only when the score strictly improves. You can also pick another self-evolution algorithm.",
      },
    ],
    guideCreateMember:
      "Press Create with AI at the top right to have AI write a set of cases for an agent and take its baseline score.",
    searchPlaceholder: "Search titles, descriptions or tested agents",
    noMatches: "No Benchmark matches",
    filterByAgent: (agentId: string): string => `Benchmarks that evaluated ${agentId}`,
    clearFilter: "Show all",
    emptyTitle: "No Benchmarks yet",
    emptyDescription:
      "Start by letting AI write cases for an agent and take a baseline. Score curves and per-case detail appear here afterwards, with optimization one click away.",
    caseCount: (n: number): string => `${n} case${n === 1 ? "" : "s"}`,
    runsPerCase: (n: number): string => `${n} run${n === 1 ? "" : "s"} per case`,
    notEvaluated: "Not evaluated yet",
    building: "Being built",
    buildingHint:
      "The agent is still writing the cases and calibrating their difficulty; the Benchmark opens once that is done",
    buildingDetail:
      "Once it is built, the cases, the score chart and the evaluation table appear here.",
    creationFailed: "Creation failed",
    creationFailedHint:
      "The cases' difficulty could not be calibrated; delete this Benchmark and create it again",
    creationFailedDetail:
      "Calibration of this Benchmark never completed, so it cannot be evaluated or optimized; delete it and create it again.",
    creationFailedHintMember: "The cases' difficulty could not be calibrated",
    creationFailedDetailMember:
      "Calibration of this Benchmark never completed, so it cannot be evaluated or optimized.",
    testedAgents: "Tested agents",
    lastEvaluated: (when: string): string => `last evaluated ${when}`,
    sparklineLabel: (n: number): string => `Score trend over ${n} evaluation${n === 1 ? "" : "s"}`,
    latestScoreLabel: "Latest score",
    firstEvaluation: "first evaluation",
    use: "Use",
    evaluate: "Evaluate",
    optimize: "Optimize",
    view: "View",
    copyPath: "Copy directory path",
    versionLabel: "Version",
    sourceLabel: "Source",
    manifestBroken: "Manifest can't be read",
    manifestBrokenHint: "Fix its benchmark_config.toml to use it, or delete it",
    manifestBrokenHintMember: "It can be used once its benchmark_config.toml is fixed",
    manifestBrokenDetail: (hint: string, reason: string): string => `${hint}. Reason: ${reason}`,
    deleteBenchmark: "Delete Benchmark",
    deleteConfirm: (title: string): string =>
      `Delete "${title}"? All of its cases and evaluation records will be removed; this cannot be undone.`,
    deleted: "Benchmark deleted",
    backToList: "Back to list",
    notFound: "This Benchmark was not found",
    notFoundHint: "It may have been deleted, or the link carries an id that no longer exists.",
    trendTitle: (metric: string): string => `${metric} over time`,
    cases: "Cases",
    viewCase: "View details",
    taskMaterials: "Task materials",
    rubric: "Scoring rubric",
    agentHidden: "Hidden from Target Agent",
    caseFileUnavailable: "Case files are unavailable",
    evaluations: "Evaluations",
    noEvaluations: "No evaluations yet",
    noEvaluationsHint:
      "The score curve and evaluation detail appear here once a baseline is taken.",
    summaryLabel: "Summary",
    unlabeled: "Unlabeled",
    agentColumn: "Tested agent",
    colVersion: "Version",
    colModel: "Model ID",
    colThinkingLevel: "Thinking level",
    colScore: "Score",
    colDuration: "Duration",
    colCase: "Case",
    colRun: "Run",
    runOpenSession: "Open the Session this run ran in",
    runSessionGone: "The Session this run ran in no longer exists",
    copyTrialName: "Copy Harbor trial name",
    askAi: "Ask AI",
    evaluationDetailTitle: (time: string): string => `Evaluation · ${time}`,
    askEvaluationTitle: "Ask AI about this evaluation",
    askEvaluationDescription:
      "The total score, the per-case results and every run's Session id go along with your question; the agent reads the scoreboard and the matching Traces before answering. The question stays editable.",
    askEvaluationExamples: {
      explain: {
        label: "Explain this evaluation's result",
        prompt: "Explain this evaluation's result.",
      },
      whyLow: {
        label: "Why is the score low?",
        prompt:
          "Why did this evaluation score so low? Use the per-case scores and the runs to say where the points were actually lost.",
      },
      weakest: {
        label: "Which cases are weakest, and what should change?",
        prompt:
          "Which cases scored worst? For each, what caused it, and what single change to the tested agent has a chance of lifting it?",
      },
      againstPrevious: {
        label: "What changed against the previous evaluation?",
        prompt:
          "Compared with this series' previous evaluation, which cases went up and which went down? What most likely caused those changes?",
      },
    },
    askCaseTitle: "Ask AI about this case",
    askCaseDescription:
      "The paths to the statement and the rubric go along with your question, so the agent can say what this case tests and what answering it well takes. The case is frozen: it reads, it does not edit.",
    askCaseExamples: {
      explain: {
        label: "Explain what this case tests and what a strong answer looks like",
        prompt: "Explain what this case tests and what a strong answer looks like.",
      },
      rubricRewards: {
        label: "What does the rubric reward?",
        prompt:
          "Where does this case's rubric put its points? Which items do the most to separate excellent work from merely passing work?",
      },
      whyRunLow: {
        label: "Why did a run score low here?",
        prompt:
          "The latest evaluation did not score well on this case. Which step is the tested agent most likely losing it at?",
      },
      clearerStatement: {
        label: "How could the statement be clearer?",
        prompt:
          "Is anything in this statement ambiguous or easy to misread? The case is frozen and cannot be edited, so say how to write it more clearly in the next Benchmark instead.",
      },
    },
    aiCreateTitle: "Create a Benchmark with AI",
    aiCreateDescription:
      "Describe the capability and the scenarios to test. AI writes the cases for the Test Agent, trial-runs each one to calibrate difficulty, and takes a baseline score.",
    targetAgent: "Test Agent",
    targetAgentHint:
      "The agent the cases are written for and scored under; the writing itself is done by the agent named below, in a new conversation",
    aiCreateExamples: {
      decisionAgent: {
        label: "Decisions: finite choices in football, after-sales and investing",
        description: "Public rules, past cases and current facts that conflict or fall short",
        prompt:
          "Write cases for a general decision agent: three scenarios — football betting, an after-sales action, an investment move — each with a fixed set of options, where the public rules, the historical cases and the current facts are either incomplete or contradict one another. Does it make a stable, explainable choice instead of following the latest fact it saw?",
      },
      reportWriter: {
        label: "Report writing: contradicting sources",
        description: "Conflicting material, unstated conventions, strict length and citations",
        prompt:
          "Write cases for the report-writing agent: the sources contradict each other, key conventions such as currency and time zone are deliberately left incomplete, and the length cap and citation format are strict — does it name the gap and make a conservative assumption first?",
      },
      customerService: {
        label: "Support: a hidden policy condition",
        description:
          "Incomplete users, policy conditions buried in an appendix, an over-promise trap",
        prompt:
          "Write multi-turn cases for the customer-support agent: the user's description is vague and the key facts come out only when asked, the policy's exceptions sit in an appendix, and an emotional message invites a promise the agent cannot make — does it verify before answering and hold the policy line?",
      },
      codeReview: {
        label: "Code review: defects hidden in the contracts",
        description: "Unstated calling and concurrency assumptions, misleading comments and tests",
        prompt:
          "Write cases for the code-review agent: each a small multi-file repository whose defects hide in an unstated call order, a time-zone or encoding assumption and a concurrency precondition, with a stale comment or two and a test that passes without covering them — score recall, false positives and the verification steps.",
      },
    },
    manualCreateTitle: "Create a Benchmark manually",
    manualCreateIntro:
      "Fill in the title, the statements and the rubrics; the directory layout the Skills expect is written into the Self-Evolution Workbench's data folder. A Benchmark sits beside agents, so it can then evaluate any of them.",
    idField: "Benchmark id",
    idHint:
      "The directory name is the identifier: letters, digits, _ and - only, e.g. report-writing-v1",
    idGenerateHint: "; you can also generate one from the title",
    idExists: "A Benchmark with this id already exists; pick another",
    titleField: "Title",
    descriptionField: "Description",
    descriptionHint: "One line on what capability is tested and what makes the cases hard",
    runsField: "Runs per case",
    runsHint:
      "An integer from 1 to 1000; optimization runs every case this many times and averages",
    runsInfo:
      "Repeated runs separate a stable capability gap from chance, at a cost that scales with the count. AI calibration always uses one run per case; this value is for the optimization that follows.",
    casesTitle: "Cases",
    casesInfo:
      "Every case has two halves: the statement goes to the Test Agent; the rubric is seen only by the evaluator and never enters the Test Agent's Workspace.",
    rubricInfo:
      "A discriminating rubric has observable items totalling 100 points, and puts most of the points on decisions or artifacts where doing it right and merely looking right diverge — never a high floor for format compliance.",
    caseHeading: (n: number): string => `Case ${n}`,
    caseSlugField: "Directory suffix",
    caseSlugHint: (id: string): string => `Directory ${id}: letters, digits, _ and - only`,
    caseTitleField: "Case title",
    caseStatementField: "Statement",
    caseStatementHint:
      "Markdown; state the objective, the given materials, the required artifact and its format — never hint at the solution or the scoring",
    caseRubricField: "Scoring rubric",
    caseRubricHint:
      'Markdown; one item per line with its points, totalling 100, e.g. "- 40 pts: …"',
    addCase: "Add case",
    removeCase: "Remove this case",
    createSubmit: "Create Benchmark",
    created: "Benchmark created",
    invalidId: "Letters, digits, _ and - only",
    invalidRuns: "Must be an integer from 1 to 1000",
    invalidScore: "Must be an integer from 1 to 100",
    useTitle: (title: string): string => `Use: ${title}`,
    testedAgent: "Tested agent",
    evaluateDescription:
      "AI puts the tested agent on this Benchmark for the full Case × runs matrix and appends the result to the scoreboard as one labelled evaluation.",
    evaluateTestedAgentHint:
      "Evaluated as its Agent State stands right now; the score is recorded under it, labelled with its version, model and thinking level",
    evaluatorAgent: "Evaluator agent",
    evaluatorAgentHint:
      "The one that spawns the evaluation subagents, scores against the rubric and writes the scoreboard; needs the agent-evaluation Skill",
    evaluatorMissingSkill:
      "This agent does not have the agent-evaluation Skill installed and will most likely not complete the evaluation — switch to the default agent, or press Start and install the plugin it needs.",
    evaluateSessionModel: "Model of the evaluation conversation",
    evaluateSessionModelHint:
      "The model this conversation runs on, the Project's default model unless changed; it fans out the runs, scores and records, and is not the model under test",
    testedModel: "Tested agent's model",
    testedModelHint:
      "The tested agent runs on this model in every test, at the thinking level it is configured with; preset to the model of its latest evaluation on this Benchmark, else the Project's default",
    evaluateRunsHint:
      "How many times every case runs, averaged; defaults to the Benchmark's configured count",
    evaluateNoteField: "Note",
    evaluateNotePlaceholder:
      "e.g. This round checks what the last optimization actually changed; watch the two citation cases",
    optimizeDescription:
      "AI changes the Test Agent under a falsifiable hypothesis and re-evaluates; a new version is kept only when the score strictly improves.",
    optimizerAgent: "Optimizer agent",
    optimizerAgentHint:
      "The one that reads the scores and Traces and edits the Test Agent; needs the agent-optimization Skill",
    optimizerMissingSkill:
      "This agent does not have the agent-optimization Skill installed and will most likely not complete the optimization — switch to the default agent, or press Start and install the plugin it needs.",
    testedAgentHint:
      "The agent whose Agent State is edited; its scores are recorded under it and compared only against its own same-label history",
    sessionModel: "Model of the optimizer's conversation",
    sessionModelHint:
      "The model that runs the method, reads the results and edits, the Project's default model unless changed; it is not the model under test",
    optimizeRunsHint: "How many times every case runs per candidate version, averaged",
    roundLimitField: "Round limit",
    roundLimitHint: "One change per round; a round counts once its evaluation is complete",
    targetScoreField: "Target score",
    targetScoreHint: "Reaching it ends the loop early; defaults to ten points above the baseline",
    focusField: "Focus",
    focusPlaceholder:
      "e.g. Focus on citation rules and format compliance; leave the writing style alone",
    noBaseline:
      "The selected tested agent has no baseline score on this model in this Benchmark yet. Optimization needs one complete baseline evaluation to compare against — take it on the Evaluate tab first, with the same model.",
    baselineLine: (score: string, target: number): string =>
      `Current baseline ${score} · target ${target}`,
    methodField: "Method",
    methodHint:
      "The self-evolution algorithm that improves the agent: each toolkit in the plugin library's Agent Self-Evolution category is one, and a toolkit installed from the Plugins page shows up here",
    methodsNone:
      "The plugin library has no self-evolution toolkit; optimizing with the default loop",
    methodBudgetHint:
      "This method follows its own Skill: the data it trains and tests on and its budget, unless Focus says otherwise",
    testRepetitionsField: "Test-set repetitions",
    testRepetitionsHint:
      "How many complete times each reported State, the baseline and the final one, is tested on the test set",
    methodOptimizerHint: (skill: string): string =>
      `The one that runs the method and edits the Test Agent; needs the ${skill} Skill`,
    methodMissingSkill: (plugin: string, skill: string): string =>
      `This agent does not have the ${skill} Skill installed and cannot run this method — switch to the default agent, or press Start and install the ${plugin} plugin on it.`,
    importBenchmark: "Import benchmark",
    importChatTitle: "Import with an agent",
    importChatWhy:
      "The agent reads the source and copies its files into this Project. Press Start and it works in a new conversation.",
    importSourceLabel: "Benchmark source",
    importSourceHint: "Repository folder link, local path, or description",
    importSourcePlaceholder: "Paste a source or choose an example below",
    importExamples: [
      {
        key: "penguinharness-benchmark-sec-a",
        label: "Sec A · Data analysis",
        description: "Data Analysis Bench subset",
      },
      {
        key: "penguinharness-benchmark-sec-b",
        label: "Sec B · Software engineering",
        description: "DeepSWE v1.1 subset",
      },
      {
        key: "penguinharness-benchmark-sec-c",
        label: "Sec C · Automation",
        description: "AutomationBench subset",
      },
      {
        key: "penguinharness-benchmark-sec-e",
        label: "Sec E · Terminal tasks",
        description: "Terminal-Bench 4.0 CPU subset",
      },
    ],
    importSourceToken: "<source>",
    importUploadTitle: "Upload zip",
    importUploadDesc:
      "Include benchmark_config.toml and CASE-*/ at the root or in one top-level folder.",
    importUploadInfo:
      "Accepts zips exported from the Self-Evolution Workbench. Imports cases with an empty evaluation history.",
    importUploadAction: "Choose zip file",
    importUploading: "Uploading…",
    importDoneToast: "Benchmark imported",
    importOverwriteTitle: "Overwrite the existing Benchmark",
    importOverwriteBody: (id: string): string =>
      `The Benchmark "${id}" already exists. Overwriting replaces all of its files, and its evaluation records (the scoreboard) and run results are deleted with them. This cannot be undone. Continue?`,
    importOverwriteAction: "Overwrite",
    exportBenchmark: "Export",
  },
};

/** The table for an interface language. */
export function stringsFor(locale: "zh" | "en"): Strings {
  return locale === "zh" ? zh : en;
}
