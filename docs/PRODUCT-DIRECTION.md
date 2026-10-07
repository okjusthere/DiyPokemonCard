# 新版产品方向与研究依据

研究日期：2026-10-07。目标是让第一次来的家长和孩子很快做出愿意保存的卡，再通过收藏、变体和线下游戏继续创作。旧站仅保留可用的账户、积分和服务接口，没有沿用旧站的视觉与单页生成流程。

## 竞品观察 → 新版决策

| 参考 | 可核查观察 | 对本次设计的影响 |
|---|---|---|
| [Pokécardmaker.net](https://pokecardmaker.net/create) / [FAQ](https://pokecardmaker.net/faq) | 模板、年代、字段和导入导出能力很深，适合熟悉卡牌的人 | 第一屏先有完成度高的卡，次要字段渐进展开 |
| [Pocket Cards](https://pocketcards.net/card-maker) | 左侧编辑、右侧预览，照片和本地草稿降低创作成本 | 保留即时反馈，默认有角色，不要求用户先填空 |
| [Pokecardmaker.org](https://pokecardmaker.org/) | 免费、无需注册、多代卡面是常见需求 | 免费编辑、下载、打印作为主干，AI 作为可选能力 |
| [Make Snapshots](https://www.makesnapshots.com/tools/pokemon-card-maker) | 宠物、照片、礼物和实体成品使用途更具体 | 照片卡、生日英雄、家庭成员和宠物超能力成为内容 |
| [Holo Card Maker](https://holocardmaker.com/) | 交互闪卡、图层和 HTML 成品强调数字卡触感 | 增加倾斜、翻面、反光与交互文件；选择明亮温暖的独立视觉方向 |
| [Pokémon Cards CSS](https://poke-holo.simey.me/) / [源项目](https://github.com/simeydotme/pokemon-cards-css) | CSS 图层、混合模式和姿态可以模拟光泽 | 独立实现简化效果，没有复制 GPL 代码，不为卡片倾斜加载大型 3D 引擎 |
| [Photo Card Booth](https://photocardbooth.com/) | 明确设置纸张、卡片尺寸与排版 | A4 / Letter、63 × 88 mm、九宫格、校准线成为独立工具 |
| [MyPokecard 打印说明](https://www.mypokecard.com/en/how-to-print) | 旧式流程需要把图片放进文档再调尺寸 | 直接提供可打印布局，减少手工步骤 |
| [ReadWriteThink Trading Card Creator](https://www.readwritethink.org/classroom-resources/student-interactives/trading-card-creator) | 卡片可以组织人物、故事和学习活动 | 保留能力描述，提供讲故事、猜角色和家庭小游戏 |
| [NN/g: Children’s Cognition](https://www.nngroup.com/articles/kids-cognition/) | 儿童界面需要明确指示、熟悉概念和可控认知负担 | 具体动词、实时预览、撤销、无需登录，以及默认有内容的起点 |

这些是定性观察，不代表竞品流量、营收或满意度结论。网站行为会变化，未编造搜索量、转化率或“最受欢迎”排名。

## 视觉与使用假设

采用纸白、靛蓝、暖黄色、圆润标题与原创伙伴插画。首页让卡片成为视觉中心，编辑器像有秩序的创作桌。不使用虚构用户数量、评分、倒计时和稀缺奖励。

1. **先看到成品，再做自己的版本。** 默认展示 Sparky，改名字即可得到反馈，假设这能降低第一次创作的门槛。
2. **同一个主题做一整队。** 宠物、家人、天气伙伴等提示，把下一张与第一张关联。假设三张的小目标更容易继续。
3. **照片缩短情感距离。** 手动照片编辑免费且在本地完成，AI 转绘是单独的成人确认操作。
4. **数字触感能带走。** PNG 适合普通分享，HTML 保留交互，打印连接现实游戏。
5. **惊喜服务创作。** 免费随机灵感揭卡，没有稀有度付费抽奖；对战是自订数值的简单比较，并提供公平分配点数的家庭规则。

以上尚未经过真实亲子用户测试。下一步请不同年龄的孩子与家长完成“改一张 → 放照片 → 保存 → 三张组队 → 打印”，观察是否需要解释、能否恢复误操作、是否主动想做第二张。

## SEO / GEO 的实现

依据 Google 官方的 [AI 优化指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)、[AI 搜索功能](https://developers.google.com/search/docs/appearance/ai-features)、[JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)、[实用内容原则](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)、[图片最佳实践](https://developers.google.com/search/docs/appearance/google-images) 和 [垃圾内容政策](https://developers.google.com/search/docs/essentials/spam-policies)。

| 页面 | 搜索意图 | 实际提供 |
|---|---|---|
| `/` | free Pokémon card maker / DIY card | 完整编辑器、示例、清楚的免费范围 |
| `/photo-card-maker` | photo to trading card / pet card | 照片流程、裁切建议、限制与隐私说明 |
| `/holographic-card-maker` | holographic card / 3D card | 效果对比、操作与动静态导出区别 |
| `/printable-trading-cards` | printable custom cards / A4 Letter | 可用的打印工具、尺寸和校准说明 |
| `/card-ideas` | trading card ideas for kids | 十二个可点击进入编辑器的具体创意 |
| `/make-a-card-game` | make your own card game | 可运行的比较器、组队与故事玩法 |

正文由服务器直接输出，JavaScript 加载前就存在。每页有独立标题、描述、canonical 和内部链接；主页提供 WebApplication / 免费 Offer 描述，内容页提供合适的页面与面包屑数据。没有虚构评分，没有把可选 AI 收费包装成全部免费。

`/studio` 作为带状态的创作入口设为 noindex，避免与首页重复。私人 API 不进索引，未知地址返回真正 404。提供 sitemap、社交分享图和本地字体。`llms.txt` 只是站点说明，不视作排名机制；GEO 没有流量保证或特殊 schema 捷径。公开 FAQ 是可读内容，没有依赖 FAQ 富结果。

不批量制造只有关键词不同的页面。不公开孩子照片、作品或昵称；文件分享由用户决定。初版面向英语市场，多语言需要真正翻译内容与界面后再设置 hreflang。

## 上线后才有答案的问题

尚未加入第三方行为追踪。测量前先确定隐私与成人同意策略。可聚合创作开始、首次编辑、保存、下载、打印入口、第二张卡和来源页面，不记录照片、卡片文字、儿童姓名或提示词。

先看是否完成第一张、是否自发做第二张，再分照片/模板入口观察。Search Console 检查索引、查询和着陆页表现。真实搜索表现、AI 引用与留存尚未验证。
