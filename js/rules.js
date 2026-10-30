// The rules text. Everything players read about the game and the scoring lives in this one file, so it is
// easy to edit. The numbers (points for a win, for a mars, how many advance) come from the tournament
// settings, so the page always matches how the standings are really calculated.

const pts = (n) => (n === 1 ? 'נקודה אחת' : `${n} נקודות`);

function pointsTable({ pointsWin, pointsMars }) {
  return `<table class="pts">
    <tr><td>ניצחון רגיל</td><td class="n">${pts(pointsWin)}</td></tr>
    <tr class="mars"><td>מארס (ניצחון כפול)</td><td class="n">${pts(pointsMars)}</td></tr>
    <tr><td>הפסד</td><td class="n">0</td></tr>
    <tr><td>ניצחון טכני (היריב לא הגיע או פרש)</td><td class="n">${pts(pointsWin)}</td></tr></table>`;
}

const cockedDie = `<div class="callout"><span class="die">🎲</span><div><b>קובייה נוטה לא נחשבת</b><br>אם אחת הקוביות לא נחה שטוחה על הלוח (נשענת על דמקה או על הקצה, או יצאה מהלוח), ההטלה בטלה ומטילים מחדש את שתי הקוביות.</div></div>`;

export function rulesHtml(s, { compact = false } = {}) {
  const { advance } = s.settings;

  if (compact) {
    return `<div class="rules-tv">
      <div class="card"><h3>ניקוד</h3>${pointsTable(s.settings)}</div>
      ${cockedDie}
      <div class="card"><h3>אחרי כל משחק</h3><ol><li>כל שחקן מדווח באתר מי ניצח</li><li>כששניכם מסכימים, מופיע המשחק הבא</li><li>לא מסכימים? קוראים למארגן</li></ol></div></div>`;
  }

  return `<div class="rules">
    <div class="card"><h2>חוקי הטורניר</h2><p class="muted" style="margin:0">קצר וברור, כדי שכולם ישחקו לפי אותם כללים.</p></div>

    <div class="card"><h3>המטרה</h3><p style="margin:6px 0 0">להוציא את כל 15 הדמקות שלך מהלוח לפני היריב.</p></div>

    <div class="card"><h3>איך משחקים</h3><ul>
      <li>מי שמתחיל נקבע בהטלה של קובייה אחת לכל שחקן. הגבוה פותח, ומשחק את שתי הקוביות שיצאו.</li>
      <li>בכל תור מטילים שתי קוביות ומתקדמים לפי המספרים: דמקה אחת בשתי הקוביות, או שתי דמקות, כל אחת לפי קובייה.</li>
      <li>דאבל (שתי קוביות זהות): משחקים את המספר ארבע פעמים.</li>
      <li>אסור לנחות על משולש שיש בו שתי דמקות או יותר של היריב.</li>
      <li>נחתת על דמקה בודדת של היריב? היא נאכלת ויושבת על הבר. מי שנאכל חייב להחזיר אותה לבית של היריב לפני כל מהלך אחר.</li>
      <li>חייבים לשחק את שתי הקוביות אם אפשר. אם אפשר לשחק רק קובייה אחת, חייבים לשחק אותה (ואם אפשר כל אחת בנפרד, את הגדולה).</li>
      <li>מתחילים להוציא דמקות מהלוח רק כשכל 15 הדמקות שלך נמצאות בבית שלך (הרבע האחרון).</li>
    </ul></div>

    ${cockedDie}

    <div class="card"><h3>ניקוד</h3>${pointsTable(s.settings)}
      <p><b>מארס:</b> סיימת להוציא את כל 15 הדמקות שלך והיריב עדיין לא הוציא אף דמקה אחת. אם נשארה לו דמקה על הבר או בבית שלך, זה גם מארס ולא יותר.</p>
      <p class="muted" style="margin:0">בשלב ההדחה אין ניקוד: מי שמנצח עולה, בלי קשר למארס.</p></div>

    <div class="card"><h3>איך הטורניר בנוי</h3><ol>
      <li><b>שלב הבתים:</b> בכל בית 3–6 שחקנים, וכל אחד משחק פעם אחת נגד כל שאר הבית. לכל בית יש שולחנות קבועים.</li>
      <li><b>דירוג הבית:</b> לפי נקודות. בשוויון מכריע הניצחון הישיר בין השחקנים השווים, אחר כך מי שניצח יותר משחקים, אחר כך מי שעשה יותר מארסים. אם עדיין שווה, המארגנים מכריעים.</li>
      <li><b>שלב ההדחה:</b> ${advance === 1 ? 'הראשון' : `${advance} הראשונים`} בכל בית עולים. משחק אחד, המנצח ממשיך והמפסיד יוצא, עד שנשאר אלוף.</li>
    </ol></div>

    <div class="card"><h3>אחרי כל משחק</h3><ol>
      <li>כל אחד מכם לוחץ באתר מי ניצח, ואם היה מארס.</li>
      <li>אם שניכם מסכימים, התוצאה נקבעת ומופיע המשחק הבא: מול מי, ובאיזה שולחן.</li>
      <li>אם אין הסכמה, המארגנים מכריעים.</li>
      <li>לפני שעוזבים את השולחן, לוודא שדיווחתם.</li>
    </ol></div>

    <div class="card"><h3>הוגנות</h3><ul>
      <li>שחקן שלא הגיע לשולחן: המארגנים יכולים לפסוק ניצחון טכני ליריב.</li>
      <li>לא מסכימים על חוק? קוראים למארגן ולא מתווכחים.</li>
    </ul></div>
  </div>`;
}
