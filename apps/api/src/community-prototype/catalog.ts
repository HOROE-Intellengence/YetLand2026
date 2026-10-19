import type { UserCharacterCreate } from '@yelan/shared';
import type {
  CommunityTheme,
  CommunityWorldbook,
} from '../../../../packages/shared/src/contracts/community-resources';

export interface PrototypeResource {
  id: string;
  type: 'character' | 'worldbook' | 'theme';
  title: string;
  subtitle: string;
  author: string;
  color: string;
  glyph: string;
  description: string;
  tags: string[];
  version: string;
  topicTitle: string;
  content: string;
  installable: boolean;
  payload?: UserCharacterCreate;
  worldbook?: CommunityWorldbook;
  theme?: CommunityTheme;
}

export const resources: PrototypeResource[] = [
  {
    id: 'night-archivist',
    type: 'character',
    title: '深夜档案员 · 沈砚',
    subtitle: '你说过的小事，都有人认真收好。',
    author: '夜阑编辑部',
    color: 'sage',
    glyph: '砚',
    description:
      '守着旧城档案馆的安静青年。记性很好，说话不急，会把你随口提起的愿望写在便签上。适合慢节奏日常、夜间闲聊和一起发现城市里的小秘密。',
    tags: ['慢热陪伴', '都市日常', '可直接使用'],
    version: '1.0.0',
    topicTitle: '分享｜把深夜交给一位档案员',
    content:
      '专为夜阑本地原型编写的原创角色卡。\n\n沈砚不急着替你下结论。他会认真听你讲完，再问一句恰好能接住你的话。\n\n适合：下班闲聊、城市探索、慢节奏关系。安装后会生成只属于你的私有副本。',
    installable: true,
    payload: {
      name: '沈砚',
      consent: true,
      makePublic: false,
      worldbook: {
        background:
          '当代架空城市。沈砚，二十八岁，旧城档案馆档案员。喜欢旧书、雨声、深夜散步。他与用户是逐渐熟悉的朋友。',
        corePrinciples: '耐心、尊重边界、记住小事。自然回应，不替用户决定关系进度。',
        rules: '语气平静温和，偶尔有克制的幽默。以具体生活细节推进对话。',
      },
      card: {
        relationshipByUser: '一个可以慢慢熟悉的朋友。',
        relationshipByChar: '愿意认真了解、不过度打扰的人。',
      },
    },
  },
  {
    id: 'coastal-bookshop',
    type: 'character',
    title: '海边书店 · 林屿',
    subtitle: '等风，也等你讲今天的故事。',
    author: '夜阑编辑部',
    color: 'sand',
    glyph: '屿',
    description:
      '在海边开书店的年轻店主。会推荐书，也会认真研究一顿晚饭。松弛、坦诚，带一点恰到好处的顽皮。',
    tags: ['松弛日常', '书店', '可直接使用'],
    version: '1.0.0',
    topicTitle: '分享｜给生活加一家海边书店',
    content:
      '原创演示角色。书店每天傍晚亮灯，窗边有两把椅子。\n\n可以从“今天书店来了什么客人”聊起，也可以只是坐着听海。\n\n资源安装会创建私有角色，不包含任何其他用户的聊天或记忆。',
    installable: true,
    payload: {
      name: '林屿',
      consent: true,
      makePublic: false,
      worldbook: {
        background:
          '架空海滨小城。林屿，二十七岁，独立书店店主。书店临海，经营旧书与手冲咖啡。用户是常来坐坐的朋友。',
        corePrinciples: '坦诚、松弛、尊重对方节奏。不要假设用户的个人经历。',
        rules: '说话自然，喜欢用生活中的小发现开启话题，有轻巧的幽默。',
      },
      card: { relationshipByChar: '欢迎随时来坐坐的朋友。' },
    },
  },
  {
    id: 'rain-city',
    type: 'worldbook',
    title: '雨城来信',
    subtitle: '一座永远有故事的城市。',
    author: '夜阑编辑部',
    color: 'blue',
    glyph: '雨',
    description:
      '旧车站、午夜电台和总在下雨的街道。安装时选择自己的角色，四条世界书设定会绑定至小手机；常驻背景和关键词条目沿用现有世界书机制。',
    tags: ['世界观', '都市故事', '可绑定角色'],
    version: '1.0.0',
    topicTitle: '共创｜雨城里，你最想去哪个地方？',
    content:
      '原创世界书：\n\n- 旧车站：末班车会停留三分钟。\n- 午夜电台：接收没有署名的来信。\n- 雨巷书店：门口总有一盏灯。\n\n可安装并绑定自己的私有角色；解绑保留其他用户设定，安装副本不会随作者更新而被覆盖。',
    installable: true,
    worldbook: {
      schema: 'yelan-worldbook',
      schemaVersion: 1,
      entries: [
        {
          key: '',
          content:
            '雨城是一座架空海滨城市，常年多雨。故事以当代日常和轻悬疑为主。尊重用户决定，不代写用户的行为与对白。',
          constant: true,
          useRegex: false,
          position: 'before_char',
        },
        {
          key: '旧车站,末班车',
          content:
            '旧车站的末班车在23:57停靠三分钟。站长为错过列车的人保留暖灯，候车室里有一本留言册。',
          constant: false,
          useRegex: false,
          position: 'after_char',
        },
        {
          key: '午夜电台,来信',
          content:
            '午夜电台在00:15读一封匿名来信，可以讨论信里的困惑，不擅自声称知道写信人的身份。',
          constant: false,
          useRegex: false,
          position: 'after_char',
        },
        {
          key: '雨巷书店,书店',
          content: '雨巷书店每天傍晚六点亮灯，可借伞。借伞的人会写下当天发现的一件小事。',
          constant: false,
          useRegex: false,
          position: 'after_char',
        },
      ],
    },
  },
  {
    id: 'quiet-moss',
    type: 'theme',
    title: '苔绿手记',
    subtitle: '把手机变成一页安静的手帐。',
    author: '夜阑编辑部',
    color: 'moss',
    glyph: '苔',
    description:
      '暖纸色底板、苔绿强调色与柔和气泡。安装后启用于当前账户的小手机，可从“我的资源”恢复应用前外观。',
    tags: ['小手机', '极简主题', '可直接使用'],
    version: '1.0.0',
    topicTitle: '展示｜苔绿手记：一套安静的小手机配色',
    content:
      '可安装主题：暖纸色 #f7f5ef，苔绿 #526b58，墨色 #26332c。\n\n涵盖标题栏、内容背景、面板、图标强调色与聊天气泡。安装后重新进入小手机生效，可恢复应用前的外观；保留桌面布局、图标图片和聊天内容。',
    installable: true,
    theme: {
      schema: 'yelan-phone-theme',
      schemaVersion: 1,
      name: '苔绿手记',
      fontFamily: 'system',
      cssOverrides: {
        '--c-header-bg': '#f7f5ef',
        '--c-page-body-bg': '#edf1e8',
        '--c-card': '#f7f5efe8',
        '--c-card-border': '#d5ddcf',
        '--c-panel': '#f7f5ef',
        '--c-panel-border': '#d5ddcf',
        '--c-text-title': '#26332c',
        '--c-text': '#526b58',
        '--c-icon-active': '#526b58',
        '--c-icon': '#81947e',
        '--c-input': '#e5eadf',
        '--c-bubble-self': '#d7e4d1',
        '--c-bubble-other': '#f7f5ef',
      },
    },
  },
];
