/** Respostas do CalDAV do iCloud, no formato real (207 Multi-Status com prefixos de namespace). */

const ms = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">${body}</multistatus>`;

export const PRINCIPAL_URL = "https://caldav.icloud.com/12345678/principal/";
export const HOME_URL = "https://p52-caldav.icloud.com/12345678/calendars/";
export const CAL_HOME = `${HOME_URL}home/`;
export const CAL_URL = `${HOME_URL}home/`;
export const CAL_WORK = "https://p52-caldav.icloud.com/12345678/calendars/work/";
export const CAL_REMINDERS = "https://p52-caldav.icloud.com/12345678/calendars/reminders/";

export const PRINCIPAL_207 = ms(
  `<response><href>/</href><propstat><prop><current-user-principal><href>/12345678/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
);

/** O host de partição vem absoluto e com porta, como o iCloud devolve. */
export const HOME_207 = ms(
  `<response><href>/12345678/principal/</href><propstat><prop><C:calendar-home-set><href>https://p52-caldav.icloud.com:443/12345678/calendars/</href></C:calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
);

export const CALENDARS_207 = ms(
  `<response><href>/12345678/calendars/</href><propstat><prop><displayname/><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
    `<response><href>/12345678/calendars/home/</href><propstat><prop><displayname>Consultório</displayname><resourcetype><collection/><C:calendar/></resourcetype><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set><A:calendar-color>#1BADF8FF</A:calendar-color></prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
    `<response><href>/12345678/calendars/work/</href><propstat><prop><displayname>Pessoal</displayname><resourcetype><collection/><C:calendar/></resourcetype><C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
    `<response><href>/12345678/calendars/reminders/</href><propstat><prop><displayname>Lembretes</displayname><resourcetype><collection/><C:calendar/></resourcetype><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
    `<response><href>/12345678/calendars/inbox/</href><propstat><prop><displayname>Entrada</displayname><resourcetype><collection/><C:schedule-inbox/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
);

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** REPORT calendar-query: um `.ics` por recurso. */
export const reportOf = (icsList: string[]) =>
  ms(
    icsList
      .map(
        (ics, i) =>
          `<response><href>/12345678/calendars/home/ev${i}.ics</href><propstat><prop><getetag>"etag${i}"</getetag><C:calendar-data>${xmlEscape(ics)}</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
      )
      .join(""),
  );

export const ctagOf = (ctag: string) =>
  ms(`<response><href>/12345678/calendars/home/</href><propstat><prop><CS:getctag>${ctag}</CS:getctag></prop><status>HTTP/1.1 200 OK</status></propstat></response>`);

/** Resposta de um servidor que não é CalDAV (HTML). */
export const NOT_XML = "<html><body>erro</body></html>";
