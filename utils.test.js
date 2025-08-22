const { parseCSV, parseMoney, toISODate } = require('./app.js');

describe('parseCSV', () => {
  test('handles simple CSV', () => {
    const text = 'a,b\n1,2';
    expect(parseCSV(text)).toEqual([
      ['a','b'],
      ['1','2']
    ]);
  });

  test('handles quoted fields with commas', () => {
    const text = 'desc,valor\n"um, dois",3';
    expect(parseCSV(text)).toEqual([
      ['desc','valor'],
      ['um, dois','3']
    ]);
  });
});

describe('parseMoney', () => {
  test('parses Brazilian formatted value', () => {
    expect(parseMoney('1.234,56')).toBeCloseTo(1234.56);
  });

  test('returns 0 for invalid input', () => {
    expect(parseMoney('abc')).toBe(0);
  });
});

describe('toISODate', () => {
  test('converts dd/mm/yyyy', () => {
    expect(toISODate('25/12/2020')).toBe('2020-12-25');
  });

  test('converts mm/dd/yyyy', () => {
    expect(toISODate('12/31/2020')).toBe('2020-12-31');
  });

  test('returns empty string for invalid date', () => {
    expect(toISODate('not-a-date')).toBe('');
  });
});
