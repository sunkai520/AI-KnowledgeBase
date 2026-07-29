export let staticAgent = [
    {
        id:1,
        name: "浏览器任务助手",
        description:
            "专业的浏览器任务执行专家，帮助执行各种浏览器任务，包括网页爬虫、自动化测试、网页优化等。",
        category: "browser",
        icon: "Document",
        iconColor: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        createTime: "2026-01-15 09:30:00",
        status: 1
    },
    // {
    //     id: 1,
    //     name: "代码审查助手",
    //     description:
    //         "专业的代码审查专家，帮助发现潜在bug、优化代码结构、提升代码质量，支持多种编程语言分析。",
    //     category: "code",
    //     icon: "Document",
    //     iconColor: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    //     createTime: "2026-01-15 09:30:00",
    // },
    // {
    //     id: 2,
    //     name: "数据分析师",
    //     description:
    //         "擅长数据清洗、统计分析、可视化建议，能够快速理解业务需求并提供数据洞察。",
    //     category: "data",
    //     icon: "DataAnalysis",
    //     iconColor: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    //     createTime: "2026-01-14 14:22:00",
    //     status: 1
    // },
    {
        id: 3,
        name: "文案创作大师",
        description:
            "专业的营销文案创作者，擅长撰写吸引人的标题、产品描述、社交媒体内容等。",
        category: "writing",
        icon: "Reading",
        iconColor: "linear-gradient(135deg, #4facfe 0%, #00f3fe 100%)",
        createTime: "2026-01-13 16:45:00",
        status: 0
    },
    {
        id: 4,
        name: "文生图助手",
        description:
            "专业的营销文案创作者，擅长撰写吸引人的标题、产品描述、社交媒体内容等。",
        category: "writing",
        icon: "PictureFilled",
        iconColor: "linear-gradient(135deg, #f093fb 0%, #00f6fe 100%)",
        createTime: "2026-01-13 16:45:00",
        status: 0
    },
    {
        id: 5,
        name: "视频创作大师",
        description:
            "专业的营销文案创作者，擅长撰写吸引人的标题、产品描述、社交媒体内容等。",
        category: "writing",
        icon: "VideoCameraFilled",
        iconColor: "linear-gradient(135deg, #4facfe 0%, #fee140  100%)",
        createTime: "2026-01-13 16:45:00",
        status: 0
    },
    {
        id: 6,
        name: "UI设计顾问",
        description: "提供界面设计建议、配色方案、布局优化等专业设计指导。",
        category: "writing", //分类
        icon: "Brush",
        iconColor: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
        createTime: "2026-01-12 11:20:00",
        status: 0
    },

]

export let agentType = [
    { value: "data", label: "数据分析", type: "success" },
    { value: "code", label: "编程开发", type: "warning" },
    { value: "writing", label: "文案创作", type: "danger" },
    { value: "other", label: "其他", type: "" },
]
export let iconDatas = [
    { name: "ChatDotRound", color: "#409EFF" },
    { name: "DataAnalysis", color: "#67C23A" },
    { name: "Reading", color: "#F56C6C" },
    { name: "Brush", color: "#909399" },
    { name: "Help", color: "#409EFF" },
    { name: "Memo", color: "#409EFF" },
]