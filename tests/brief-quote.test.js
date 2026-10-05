const assert = require('node:assert/strict');
const q = require('../brief-quote');
const parse = q.parse;
const price = text => q.estimate(parse(text));
assert.equal(price('패션영상 최종본 5~7분 1캠 원본 20분. 사진은 100%는 아니지만 찾아서 드릴 예정').recommended, 180000);
assert.equal(price('다큐 최종본 15분 1캠 원본 90분').recommended, 400000);
assert.equal(parse('다큐 캠 1개 최종본 15분\n원본은 일정치않습니다\n원본 기존꺼 평균 체크해봐야하는데 2시간은 안나올 것 같습니다!').raw, 120);
assert.equal(parse('다큐 캠 1개 최종본 15분\n원본은 일정치않습니다\n원본 기존꺼 평균 체크해봐야하는데 2시간은 안나올 것 같습니다!').minutes, 15);
assert.equal(parse('원본 1시간 30분 최종본 6분 30초').raw, 90);
assert.equal(parse('원본 1시간 30분 최종본 6분 30초').minutes, 6.5);
assert.equal(parse('원본 60~90분 최종본 10~15분').raw, 90);
assert.equal(parse('원본 60~90분 최종본 10~15분').minutes, 15);
assert.equal(parse('원본 미정 최종본 15분').raw, 30);
assert.equal(parse('패션영상입니다 그리고 5분 ~7분 전후가 될 것 같습니다').minutes, 7);
assert.equal(parse('https://youtu.be/OwwSfFs7E-0').hasConditions, false);
assert.equal(parse('원본 90분').minutes, 10);
assert.equal(parse('캠 3개 최종본 15분').cameras, 3);
assert.equal(parse('컷편집은 이미 되어있고 종편만 20분').scope, 'locked');
assert.equal(parse('컷편집은 안되어있고 원본 편집부터 해야함').scope, 'full');
assert.equal(parse('투캠 최종본 15분').cameras, 2);
assert.equal(parse('사진 없음 자막 제외').photos, 'none');
assert.equal(parse('사진 없음 자막 제외').captions, false);
assert.equal(parse('사진 전부 제공').photos, 'provided');
assert.equal(parse('롱폼 최종본 15분 숏폼 8개').profile, 'general');
assert.ok(parse('롱폼 최종본 15분 숏폼 8개').assumptions.some(a => a.includes('미포함')));
assert.equal(price('2캠 최종본 15분 원본 15분. 축소 편집하실 필요가 없습니다').recommended, 300000);
assert.equal(price('3캠 최종본 15분 원본 15분. 축소 편집하실 필요가 없습니다').recommended, 350000);
const short = price('숏폼 최종본 30초 원본 5분 1캠 수정 0회');
assert.ok(short.recommended >= 30000);
const one = price('숏폼 최종본 60초 1캠 원본 10분 월 10편 수정 2회');
assert.equal(one.minutes, 1);
assert.equal(one.monthlyTotal, one.recommended * 10);
assert.ok(price('다큐 최종본 15분 1캠 원본 120분').recommended > price('다큐 최종본 15분 1캠 원본 60분').recommended);
assert.ok(q.estimate({ ...parse('패션 7분'), minutes: NaN }).error);
assert.ok(q.estimate({ ...parse('패션 7분'), daily: 0 }).error);
assert.ok(q.estimate({ ...parse('패션 7분'), revisions: -1 }).error);
const normal = price('최종본 10분 원본 30분 1캠');
const revised = q.estimate({ ...normal, revisions: 2 });
assert.ok(revised.recommended > normal.recommended);
assert.ok(!q.reply(normal).includes('영업일 내'));
assert.ok(q.reply(normal).includes('가견적'));
assert.equal(normal.items.reduce((s, i) => s + i.amount, 0), normal.recommended);
console.log('PASS free consultation parsing, pricing, scope and capacity checks');

const heavy = { difficulty: 'high', summary: '2캠 인터뷰', estimatedCameraCount: 2, cameraConfidence: 0.8, contentType: 'longform',
  workFactors: { cutDensity: 'high', pointTypography: 'high', motionGraphics: 'medium', soundEffects: 'high', broll: 'high', inserts: 'medium', subtitleDensity: 'high' } };
const linkOnly = parse('인터뷰 영상 편집 https://www.youtube.com/watch?v=OwwSfFs7E-0');
const merged = q.applyReference(linkOnly, { mode: 'video', analysis: heavy, durationSeconds: 754 });
assert.equal(merged.cameras, 2);
assert.equal(merged.minutes, 12.5);
assert.equal(merged.photos, 'partial');
assert.equal(merged.intensity, 0.2);
assert.ok(!merged.assumptions.some(a => a.includes('보관만')));
assert.ok(merged.questions.some(t => t.includes('2캠으로 촬영')));
const mergedQuote = q.estimate(merged);
assert.ok(mergedQuote.items.some(i => i.name.startsWith('편집 강도 +20%')));
assert.ok(mergedQuote.recommended > q.estimate({ ...merged, intensity: 0 }).recommended);
assert.ok(q.reply(mergedQuote).includes('레퍼런스 영상을 확인해 2캠'));
const textWins = q.applyReference(parse('1캠 최종본 10분 사진 없음 https://youtu.be/OwwSfFs7E-0'), { mode: 'video', analysis: heavy, durationSeconds: 754 });
assert.equal(textWins.cameras, 1);
assert.equal(textWins.minutes, 10);
assert.equal(textWins.photos, 'none');
const editedWins = q.applyReference({ ...linkOnly, cameras: 3, edited: ['cameras', 'intensity'] }, { mode: 'channel', videoCount: 3, analysis: heavy });
assert.equal(editedWins.cameras, 3);
assert.equal(editedWins.intensity, 0);
const unsure = q.applyReference(linkOnly, { mode: 'video', analysis: { ...heavy, cameraConfidence: 0.4 } });
assert.equal(unsure.cameras, 1);
assert.ok(unsure.assumptions.some(a => a.includes('미반영')));
const shorts = q.applyReference(parse('편집 문의 https://youtube.com/shorts/OwwSfFs7E-0'), { mode: 'video', analysis: { ...heavy, contentType: 'shortform' }, durationSeconds: 45 });
assert.equal(shorts.profile, 'shortform');
assert.equal(shorts.minutes, 0.8);
assert.ok(q.estimate({ ...normal, intensity: 0.9 }).error);
assert.equal(q.referenceIntensity({ difficulty: 'basic', workFactors: {} }), 0);
console.log('PASS reference video analysis fills open conditions without overriding the inquiry');
const cooking = parse(`롱폼제작이구요 유튜브가 처음이라 영상 촬영을 아직 잘 못하다보니까
영상이 dslr, 핸드폰, 오즈모
이렇게 3개 영상이구요
메인소리는 오즈모에 담겨있습니다
촬영시간은 2시간 이내이구요
영상은 동시에 시작은 아니고 각  카메라로 시작부분 끝부분이 조금씩다르긴합니다
그래서 총 영상은 3분~5분 정도 예상입니다
유튜브 '임대표의 식탁' 검색해보시면 최근영상 편집한거 있습니다
인트로+요리순서+중간중간 재밋는부분+소리+색감+자막+화면효과+가끔 드립 자막+bgm+효과음`);
assert.equal(cooking.cameras, 3);
assert.equal(cooking.raw, 120);
assert.equal(cooking.minutes, 5);
assert.equal(cooking.sync, true);
assert.equal(cooking.intensity, 0.2);
assert.equal(cooking.channelQuery, '임대표의 식탁');
assert.ok(!cooking.questions.some(t => t.includes('카메라')));
const cookingQuote = q.estimate(cooking);
assert.ok(cookingQuote.items.some(i => i.name === '멀티캠 싱크·오디오 정리' && i.amount === 30000));
assert.equal(cookingQuote.recommended, 300000);
assert.ok(q.reply(cookingQuote).includes('3캠 싱크 정리와 수정'));
assert.equal(parse('핸드폰으로 촬영한 영상 최종본 5분').cameras, 1);
assert.ok(parse('핸드폰으로 촬영한 영상 최종본 5분').questions.some(t => t.includes('카메라')));
assert.equal(q.applyReference(cooking, { mode: 'channel', analysis: { summary: 'x', workFactors: {} } }).intensity, 0.2);
console.log('PASS camera devices, shoot length, sync, requested extras and channel names are read from the inquiry');
