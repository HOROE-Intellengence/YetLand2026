import * as C from './checkphone-config';

// Local starter examples. Never saved as a generated snapshot or memory event.
export const STARTER_CONTENT_LABEL = '初始示例 · 刷新后生成角色内容';
const date = '2026-01-01T12:00:00.000Z';
const header = { headerSubtitle: STARTER_CONTENT_LABEL };
const profile = { name: '手机主人', handle: '@phone', bio: STARTER_CONTENT_LABEL, followingCount: 0, followerCount: 0 };
const message = { id: 'starter-message', text: '欢迎打开小手机。这里是初始示例，刷新后可查看角色的专属日常。', timeLabel: '12:00', direction: 'incoming' as const };
export const starterProducts: C.CheckPhoneShoppingProduct[] = [
  { id: 'starter-notebook', title: '方格随身手帐', merchantLabel: '纸间小铺', priceLabel: '¥ 28', tagLabel: '文具', subtitle: '把今天值得记住的事写下来', detail: 'A6 方格内页与柔软封面。初始虚拟商品，可查看、收藏或加入购物车。', previewIcon: '📓', tone: 'ivory' },
  { id: 'starter-cup', title: '雾蓝陶瓷杯', merchantLabel: '日常器物', priceLabel: '¥ 45', tagLabel: '家居', subtitle: '给慢下来的片刻留一杯温热', detail: '圆润杯口，容量 300ml。初始虚拟商品。', previewIcon: '☕', tone: 'mist' },
  { id: 'starter-lamp', title: '暖光阅读灯', merchantLabel: '晚间商店', priceLabel: '¥ 89', tagLabel: '生活', subtitle: '在窗边留一盏灯', detail: '柔和暖光，适合阅读与书写。初始虚拟商品。', previewIcon: '💡', tone: 'blush' },
  { id: 'starter-bag', title: '棉麻通勤袋', merchantLabel: '轻装出门', priceLabel: '¥ 39', tagLabel: '穿搭', subtitle: '装下书本和路上的小发现', detail: '自然棉麻材质，简洁内袋。初始虚拟商品。', previewIcon: '👜', tone: 'graphite' },
  { id: 'starter-balm', title: '无香润唇膏', merchantLabel: '日常护理', priceLabel: '¥ 19', tagLabel: '个护', subtitle: '放进口袋的日常护理', detail: '简洁便携的无香润唇膏。初始虚拟商品。', previewIcon: '🧴', tone: 'blush' },
  { id: 'starter-tea', title: '茉莉茶包', merchantLabel: '街角茶屋', priceLabel: '¥ 24', tagLabel: '饮品', subtitle: '给午后留一杯清茶', detail: '独立小袋，清香温和。初始虚拟商品。', previewIcon: '🍵', tone: 'mist' },
];
type Payloads = {
  phone: C.CheckPhonePhonePayload; messages: C.CheckPhoneMessagesPayload; browser: C.CheckPhoneBrowserPayload;
  photos: C.CheckPhonePhotosPayload; chat: C.CheckPhoneChatPayload; shopping: C.CheckPhoneShoppingPayload;
  assets: C.CheckPhoneAssetsPayload; notes: C.CheckPhoneNotesPayload; reading: C.CheckPhoneReadingPayload;
  xiaohongshu: C.CheckPhoneXiaohongshuPayload; takeout: C.CheckPhoneTakeoutPayload; weibo: C.CheckPhoneWeiboPayload;
  douyin: C.CheckPhoneDouyinPayload; email: C.CheckPhoneEmailPayload; music: C.CheckPhoneMusicPayload;
  x: C.CheckPhoneXPayload; reddit: C.CheckPhoneRedditPayload; youtube: C.CheckPhoneYoutubePayload;
  bilibili: C.CheckPhoneBilibiliPayload; instagram: C.CheckPhoneInstagramPayload; telegram: C.CheckPhoneTelegramPayload;
  steam: C.CheckPhoneSteamPayload; douban: C.CheckPhoneDoubanPayload;
};
const note = { id: 'starter-note', authorName: '日常收藏家', title: '把生活调慢一点', body: '收起消息提醒，泡一杯热茶，读几页喜欢的书。给自己留一段不被催促的时间。\n\n这是初始示例，刷新后会生成角色专属内容。', coverIcon: '🌿', tone: 'mist' as const, tags: ['日常', '初始示例'], likeCount: 0, commentCount: 0, saveCount: 0, comments: [] };
const video = { id: 'starter-video', title: '窗边的十分钟', caption: STARTER_CONTENT_LABEL, tone: 'mist' as const, createdAt: date, comments: [], coverIcon: '🌤️', videoDescription: '阳光穿过窗帘，茶杯旁摊开一本书。' };
const book = { id: 'starter-book', title: '窗边的片刻', author: '夜阑', coverIcon: '📖', tone: 'linen' as const, status: 'reading' as const, progressLabel: '初始示例', summary: '一段关于停下来、听见日常的小故事。', tags: ['短篇', '初始示例'] };
const track = { id: 'starter-track', title: '晚风', artist: '夜阑示例曲目', albumTitle: '日常片刻', coverIcon: '🎵', tone: 'mist' as const, durationLabel: '03:20', note: STARTER_CONTENT_LABEL };
const movie = { id: 'starter-video', title: '城市散步：一条安静的小路', channelName: '慢生活频道', createdAt: date, durationLabel: '08:00', playCount: 0, progressLabel: '初始示例', stateNote: STARTER_CONTENT_LABEL, feeling: '沿着树荫与街角的小店，发现日常里的细节。' };
const post = { id: 'starter-post', body: '给忙碌的一天留一点空白。初始示例，刷新后查看角色动态。', createdAt: date, replyCount: 0, repostCount: 0, likeCount: 0, viewCount: 0, note: STARTER_CONTENT_LABEL };
const game = { id: 'starter-game', title: '星光漫步', icon: '🎮', genre: '探索', totalHours: 0, progressPercent: 0, lastPlayedAt: date, status: '初始示例', note: '在安静的小镇里探索与收集。' };
const weiboPost: C.CheckPhoneWeiboPost = { id: 'starter-post', authorName: '日常收藏家', authorBadge: '初始示例', body: note.body, mediaIcon: '🌿', tone: 'mist', repostCount: 0, commentCount: 0, likeCount: 0, comments: [] };

const defaults: Payloads = {
  phone: { ...header, headerTitle: '电话', recents: [{ id: 'starter-call', name: '示例联系人', createdAt: date, durationLabel: '00:30', direction: 'incoming', summary: '初始通话示例，刷新后生成角色记录。', innerThought: STARTER_CONTENT_LABEL }], contacts: [{ id: 'starter-contact', name: '示例联系人', tagLabel: '初始示例', note: '联系人卡片示例', accentLabel: '示例' }], voicemails: [{ id: 'starter-voice', name: '示例联系人', createdAt: date, durationLabel: '00:10', transcript: message.text }] },
  messages: { ...header, headerTitle: '信息', threads: [{ id: 'starter-thread', sender: '小手机', preview: message.text, timeLabel: '12:00', kind: '初始示例', messages: [message] }] },
  browser: { ...header, headerTitle: '浏览器', history: [{ id: 'starter-history', title: '周末散步路线', urlLabel: '初始浏览示例', createdAt: date, content: '沿着河边走一段，带一本书，在树荫里休息。', context: STARTER_CONTENT_LABEL, innerThought: '页面可以直接打开阅读。' }], bookmarks: [{ id: 'starter-bookmark', title: '给自己的一点闲暇', urlLabel: '初始书签示例', categoryLabel: '生活', content: note.body, reason: STARTER_CONTENT_LABEL }] },
  photos: { ...header, headerTitle: '相册', albums: [{ id: 'starter-album', title: '日常片刻', coverPhotoId: 'starter-photo', count: 1, updatedLabel: '初始示例', moodLabel: '安静' }], photos: [{ id: 'starter-photo', albumId: 'starter-album', title: '窗边的光', shotAtLabel: '初始示例', locationLabel: '窗边', description: '阳光落在摊开的书页和茶杯旁。刷新后查看角色的相册。', tone: 'mist', previewIcon: '🌤️' }] },
  chat: { ...header, headerTitle: '聊天', conversations: [{ id: 'starter-chat', name: '示例联系人', preview: message.text, timeLabel: '12:00', tagLabel: '初始示例', messages: [message] }], groups: [], momentsFeed: [{ id: 'starter-moment', authorLabel: '日常收藏家', authorAccent: '初始示例', timeLabel: '12:00', body: note.body, mediaLabel: '窗边的光', likeCountLabel: '0', commentCountLabel: '0', comments: [] }], contacts: [{ id: 'starter-contact', name: '示例联系人', tagLabel: '初始示例', relationLabel: '示例', recentLabel: '欢迎打开小手机', note: STARTER_CONTENT_LABEL }] },
  shopping: { ...header, headerTitle: '购物', searchHint: '搜索日常好物', stats: { pendingCount: 0, cartCount: 0, savedCount: 0 }, recentlyViewed: starterProducts, recommendations: starterProducts, savedItems: [], cartItems: [], orders: [] },
  assets: { ...header, headerTitle: '资产', headline: { totalLabel: '¥ 0.00', periodLabel: '初始示例' }, accounts: [{ id: 'starter-account', title: '示例账户', kind: 'cash', bankLabel: '虚拟钱包', maskedNumber: '0000', cardStyle: 'silver', balance: '¥ 0.00', note: STARTER_CONTENT_LABEL, accentLabel: '常用' }], activities: [] },
  notes: { ...header, headerTitle: '备忘录', notes: [{ id: 'starter-note', title: '今天的小计划', preview: '读书、散步、记住一件开心的小事', body: '读几页书，出门走一走，记住一件让你开心的小事。\n\n初始示例，刷新后查看角色备忘录。', updatedLabel: '初始示例', tagLabel: '日常', tone: 'mist' }] },
  reading: { ...header, headerTitle: '阅读', profile: { status: '初始示例', updatedLabel: '等待刷新', summary: STARTER_CONTENT_LABEL }, currentBooks: [book], libraryBooks: [book], highlights: [{ id: 'starter-highlight', bookId: book.id, quote: '有些日子不需要奔跑，慢慢走就很好。', chapterLabel: '窗边', note: STARTER_CONTENT_LABEL }], notes: [{ id: 'starter-reading-note', bookId: book.id, title: '留白', body: '给日常留一点时间。初始阅读示例。', updatedLabel: '初始示例' }] },
  xiaohongshu: { ...header, headerTitle: '小红书', profile: { ...profile, likedAndSavedCount: 0 }, homeNotes: [note], videoNotes: [{ ...note, id: 'starter-xhs-video', videoDescription: video.videoDescription }], myNotes: [], messageOverview: { likesAndSavesCount: 0, newFollowersCount: 0, commentsAndMentionsCount: 0 }, messageThreads: [] },
  takeout: { ...header, headerTitle: '外卖', orders: [{ id: 'starter-order', shopName: '街角茶屋（示例）', category: '饮品', createdAt: date, icon: '🍵', status: '示例订单', amount: 18, items: [{ name: '茉莉清茶', icon: '🍵' }], note: STARTER_CONTENT_LABEL, scenario: '一个放慢脚步的午后', innerVoice: '初始示例，刷新后查看角色订单。' }] },
  email: { ...header, headerTitle: '邮箱', emails: [{ id: 'starter-email', senderName: '小手机', senderAddress: 'hello@example.com', subject: '欢迎来到你的日常', preview: message.text, timeLabel: '12:00', body: message.text, recipientLabel: '手机主人' }] },
  music: { headerTitle: '音乐', profile: { nickname: '手机主人', listeningMood: '初始示例', monthlyMinutesLabel: '0 分钟', topArtistLabel: '夜阑示例曲目' }, nowPlayingTrackId: track.id, recentTracks: [track], likedTracks: [], playlists: [{ id: 'starter-playlist', title: '晚间片刻', subtitle: STARTER_CONTENT_LABEL, coverIcon: '🌙', tone: 'mist', trackIds: [track.id], curatorNote: STARTER_CONTENT_LABEL }] },
  weibo: { ...header, headerTitle: '微博', profile: { ...profile, likedTotal: 0 }, homePosts: [weiboPost], trendingTopics: [{ id: 'starter-topic', title: '给生活一点留白', heatLabel: '初始示例', summary: '那些让日常变得柔软的小事。', relatedPostIds: [weiboPost.id] }], messageOverview: { mentionsCount: 0, commentsCount: 0, likesCount: 0 }, messageThreads: [], myPosts: [] },
  douyin: { ...header, headerTitle: '抖音', profile, works: [video], savedVideos: [], likedVideos: [] },
  x: { ...header, headerTitle: 'X', profile, posts: [post], replies: [], media: [], likes: [] },
  reddit: { ...header, headerTitle: 'Reddit', profile: { ...profile, followers: 0, postKarma: 0, commentKarma: 0, cakeDay: '初始示例' }, posts: [{ id: 'starter-post', communityName: 'r/SlowLiving', title: '今天做一件让自己放松的小事', body: note.body, createdAt: date, upvoteCount: 0, commentCount: 0, viewCount: 0, innerThought: STARTER_CONTENT_LABEL }], comments: [] },
  youtube: { ...header, headerTitle: 'YouTube', watchHistory: [movie], watchLater: [], likedVideos: [] },
  bilibili: { ...header, headerTitle: '哔哩哔哩', watchHistory: [{ ...movie, upName: movie.channelName, icon: '🌿', visualDescription: '树荫下的一条安静小路' }], favorites: [] },
  instagram: { ...header, headerTitle: 'Instagram', profile: { ...profile, username: 'phone' }, highlights: [{ id: 'starter-highlight', title: '日常', coverIcon: '🌿', description: STARTER_CONTENT_LABEL }], posts: [{ id: 'starter-post', coverIcon: '🌤️', imageDescription: '窗边的阳光与书页', createdAt: date, caption: note.body, likeCount: 0, commentCount: 0, shareCount: 0, comments: [] }] },
  telegram: { ...header, headerTitle: 'Telegram', threads: [{ id: 'starter-thread', title: 'Saved Messages', kind: 'saved', unreadCount: 0, messages: [{ id: 'starter-message', authorName: '手机主人', text: note.body, createdAt: date, direction: 'outgoing' }] }] },
  steam: { headerTitle: '游戏库', profile: { ...profile, bio: STARTER_CONTENT_LABEL }, recentlyPlayed: [{ ...game, recentHours: 0 }], wishlist: [], library: [game] },
  douban: { ...header, headerTitle: '豆瓣', profile: { ...profile, wantWatchCount: 0, wantReadCount: 0 }, activities: [{ id: 'starter-activity', type: 'diary', actionLabel: '初始示例', title: '今天慢一点', body: note.body, createdAt: date, reactionCount: 0, commentCount: 0 }], myGroups: [], repliedTopics: [], publishedTopics: [] },
};

export function createStarterManifest(characterId: string): C.CheckPhoneManifest {
  const dockAppIds = [...C.CHECKPHONE_DOCK_APP_IDS];
  const fixedAppIds = [...C.CHECKPHONE_FIXED_APP_IDS];
  const optionalAppIds = ['reading', 'xiaohongshu', 'takeout', 'weibo', 'douyin', 'email', 'music', 'steam'] satisfies C.CheckPhoneAppId[];
  const topAppIds = [...fixedAppIds, ...optionalAppIds];
  return { characterId, dockAppIds, fixedAppIds, optionalAppIds, topAppIds, allAppIds: [...dockAppIds, ...topAppIds], generatedAt: date, updatedAt: date };
}

export function createStarterSnapshot(characterId: string, appId: C.CheckPhoneAppId): C.CheckPhoneSnapshot {
  return { id: `${characterId}:${appId}`, characterId, appId, generatedAt: date, updatedAt: date, summary: STARTER_CONTENT_LABEL, payload: structuredClone(defaults[appId]) };
}
