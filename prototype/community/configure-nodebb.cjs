const { createRequire } = require('node:module');
const requireNodeBB = createRequire('/usr/src/app/app.js');
const nconf = requireNodeBB('nconf');
nconf.file({ file: '/opt/config/config.json' });
const db = requireNodeBB('./src/database');
(async () => {
  await db.init();
  await db.sortedSetAdd('plugins:active', Date.now(), 'nodebb-plugin-yelan-local');
  await db.setObject('config', {
    title: '夜阑社区',
    browserTitle: '夜阑社区 · 本地原型',
    description: '一起分享角色、资源与灵感。',
    defaultLang: 'zh-CN',
    minimumPostLength: 2,
    minimumTitleLength: 2,
    postDelay: 2,
    newbiePostDelay: 2,
    initialPostDelay: 0,
    postQueue: 1,
    postQueueReputationThreshold: 1,
    registrationType: 'disabled',
    disableChat: 1,
    activitypubEnabled: 0,
    minimumReputationToUpvote: 0,
    'reputation:disabled': 0,
  });
  await db.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
