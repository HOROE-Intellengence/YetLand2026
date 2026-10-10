import { expect, it } from 'vitest';
import { Pagination, paginationState } from './Pagination';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
it('disables next when all records fit, including empty results and exact page boundaries', () => {
  for (const count of [0, 5, 6, 30]) expect(paginationState(1, count, 30)).toEqual({pages:1,previous:false,next:false});
});
it('allows both directions only within available pages', () => {
  expect(paginationState(1,55,30)).toEqual({pages:2,previous:false,next:true});
  expect(paginationState(2,55,30)).toEqual({pages:2,previous:true,next:false});
  expect(paginationState(2,75,30)).toEqual({pages:3,previous:true,next:true});
});
it('renders disabled controls and an explanation for a one-page listing', () => {
  const html = renderToStaticMarkup(createElement(Pagination, {page:1,total:5,pageSize:30,onChange:()=>{}}));
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).toContain('第 1 / 1 页 · 共 5 条');
  expect(html).toContain('已全部显示，无需翻页');
});
it('locks both controls during a page request', () => {
  const html = renderToStaticMarkup(createElement(Pagination, {page:2,total:90,pageSize:30,loading:true,onChange:()=>{}}));
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).toContain('加载中');
});
