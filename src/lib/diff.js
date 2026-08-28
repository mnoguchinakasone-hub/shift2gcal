/**
 * 登録プランと既存カレンダーイベントの差分計算（純粋ロジック）。
 *
 * 既存イベントは拡張プロパティ（source / targetDay / hash）で識別する。
 * 手動で追加した予定には拡張プロパティが無いため、この差分の対象にならない。
 */

/**
 * @param {object[]} entries 登録プラン（shift.js の buildMonthPlan の entries）
 * @param {object[]} existing 既存イベント（Google Calendar API の events.list 結果）
 * @returns {{ create: object[], update: object[], unchanged: object[], remove: object[] }}
 */
export function diffPlan(entries, existing) {
  const existingByDay = indexExistingByDay(existing);
  const create = [];
  const update = [];
  const unchanged = [];

  for (const entry of entries) {
    const event = existingByDay.get(entry.targetDay);
    if (!event) {
      create.push({ action: 'create', entry });
      continue;
    }
    existingByDay.delete(entry.targetDay);
    if (event.extendedProperties?.private?.hash === entry.hash) {
      unchanged.push({ action: 'unchanged', entry, eventId: event.id });
    } else {
      update.push({ action: 'update', entry, eventId: event.id, before: summarize(event) });
    }
  }

  // プランに残らなかった既存イベント（休日化・シフト削除など）は削除対象。
  const remove = [...existingByDay.values()].map((event) => ({
    action: 'remove',
    targetDay: event.extendedProperties?.private?.targetDay ?? '',
    eventId: event.id,
    before: summarize(event),
  }));
  remove.sort((a, b) => a.targetDay.localeCompare(b.targetDay));

  return { create, update, unchanged, remove };
}

/**
 * 既存イベントを targetDay をキーにした Map にする。
 * 同じ日に複数ある場合は1件だけ残し、残りは削除対象として扱えるよう別キーで保持する。
 */
function indexExistingByDay(existing) {
  const map = new Map();
  let orphanIndex = 0;
  for (const event of existing) {
    const targetDay = event.extendedProperties?.private?.targetDay;
    if (!targetDay) {
      map.set(`__orphan__${orphanIndex += 1}`, event);
      continue;
    }
    if (map.has(targetDay)) {
      map.set(`__duplicate__${targetDay}__${orphanIndex += 1}`, event);
      continue;
    }
    map.set(targetDay, event);
  }
  return map;
}

/** プレビュー表示用に既存イベントを短くまとめる。 */
function summarize(event) {
  const start = event.start?.dateTime ?? event.start?.date ?? '';
  const end = event.end?.dateTime ?? event.end?.date ?? '';
  return { title: event.summary ?? '', start, end };
}

/** 差分の件数サマリを返す。 */
export function countDiff(diff) {
  return {
    create: diff.create.length,
    update: diff.update.length,
    unchanged: diff.unchanged.length,
    remove: diff.remove.length,
  };
}
