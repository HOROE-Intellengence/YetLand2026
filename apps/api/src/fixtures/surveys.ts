import type { Survey } from '@yelan/shared';

export const mockActiveSurvey: Survey = {
  id: 'srv_1', title: '一问', rewardCandle: 30, status: 'active',
  questions: [
    { id: 'q1', type: 'single', title: '今晚他/她说的哪一句最让你停了一拍？',
      options: [{ value: 'a', label: '"我等了你很久。"' }, { value: 'b', label: '"坐下吧。"' }, { value: 'c', label: '其他' }],
      minSeconds: 5,
    },
    { id: 'q2', type: 'text', title: '如果可以，你想对他说一句什么？', minSeconds: 5 },
  ],
};
