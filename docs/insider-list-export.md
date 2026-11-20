# Insider-list export

Wall can export the crossings of a walled project as a CSV laid out after the EU template for one section of an insider list. This page records which template that is, how each column is filled, and what Wall deliberately leaves blank. It is a description of a file layout, not legal advice: using the layout does not by itself make anyone's insider list compliant with the Market Abuse Regulation or any other rule.

Code: [src/engine/export.js](../src/engine/export.js). Tests: [test/export.test.js](../test/export.test.js).

## Which template

- **Commission Implementing Regulation (EU) 2026/1291** of 12 June 2026 sets the format of insider lists under Article 18 of the Market Abuse Regulation (Regulation (EU) No 596/2014). Reference: OJ L, 2026/1291, 15.6.2026, http://data.europa.eu/eli/reg_impl/2026/1291/oj. Article 3 repeals Implementing Regulation (EU) 2022/1210; under Article 4 it entered into force on the twentieth day after publication, 5 July 2026.
- The four header labels and seven column headings in `INSIDER_LIST_LAYOUT` were compared, character for character after whitespace normalisation, with the Official Journal text of Annex I, Template 1 ("Template for the insider lists referred to in Article 1(1) and Article 2(2), first subparagraph") on 20 November 2026; all eleven match.
- It implements Article 18(9) as rewritten by the EU Listing Act (Regulation (EU) 2024/2809): the lighter format that used to be reserved for SME growth market issuers now applies to all insider lists. Every template now has seven columns; the repealed 2022/1210 event-based template had twelve (including birth surname, personal phone numbers, home address and a separate date of birth).
- The Listing Act did not change Article 18(1) to (5): the list still covers everyone with access to the inside information, each person must acknowledge their duties in writing, and the list is kept for at least five years after it is drawn up or updated.
- Status checked on 19 November 2026: 2026/1291 in force, with no amendment or corrigendum recorded; nothing further pending on the insider-list standards.

Wall uses **Annex I, Template 1**: the section for one specific piece of inside information. One walled project is one section. Template 2 (permanent insiders) and Annex II (SME growth market list of people with regular access) are not produced; a walled project is about one piece of information, not about standing access to all of it.

## The file

Two files come out of one export.

### 1. Insider list (template layout only)

Four header lines, an empty line, the seven column headings, then one row per crossing, in the order access was obtained.

| Template field | Filled from |
|---|---|
| Description of the specific piece of inside information to which this section relates to: | The wall's subject, entered when the wall is raised |
| Date and time of creation of this section (i.e. when the specific piece of inside information was identified): | The wall's "identified at" time |
| Date and time of the last update of this section: | The latest ledger record that added a person or recorded an end |
| Date of transmission to the competent authority: | Blank, or the date given when exporting for transmission |

| # | Column heading (as in the template) | Filled from |
|---|---|---|
| 1 | First name(s) of the insider (...) | Wall's separate insider-details store, if entered; otherwise blank |
| 2 | Surname(s) of the insider (...) | Same as column 1 |
| 3 | Professional telephone number(s) (work direct telephone line and work mobile numbers) | Insider-details store, digits only (a leading "+" becomes "00"); otherwise blank |
| 4 | Function and reason for being insider | The crossing's function and reason; for a third-party service provider, the company name and address are appended, as the template asks |
| 5 | Obtained (the date and time when the insider obtained access to the specific piece of inside information) | The crossing's "obtained at" time; for an unrecorded crossing recorded after the fact, the audit-log time of the change that gave access |
| 6 | Ceased (the date and time when the insider ceased to have access to the specific piece of inside information) | The crossing's end time, or blank while access continues |
| 7 | National Identification Number (if applicable) or otherwise Date of Birth | **Always blank.** Wall never stores either; the issuer completes it offline |

Format rules from the template: dates and times as `yyyy-mm-dd, hh:mm UTC`, dates as `yyyy-mm-dd`, phone numbers as numbers without spaces. CSV rules Wall adds: RFC 4180 quoting (several headings and every date-time contain commas), UTF-8 with a byte-order mark and CRLF line ends so spreadsheets open it cleanly, and a leading apostrophe on any cell that a spreadsheet would run as a formula.

### 2. Evidence file (internal)

The same rows with the facts behind them: crossing id, Atlassian account id, display name (resolved at export time), access route, approver, requester, expiry, acknowledgement time and the SHA-256 of the acknowledgement statement, end cause, whether it was a baseline crossing, the record time, and the sequence number and SHA-256 hash of the ledger record that granted it. People who can see the project without a recorded crossing are listed with "NOT RECORDED" and the attributed change. The file ends with the ledger head (sequence and hash), the export time and the layout reference.

## Warnings before sending

The export refuses to run on a ledger that fails verification. Otherwise it returns warnings to fix first: rows without names, crossings past their expiry that were not ended, insiders who have not acknowledged, people who can see the project without a recorded crossing (they are not on the list), and openings in the permission scheme (anyone, any logged-in user).

## Personal data and retention

- Article 18(5) of the Market Abuse Regulation: keep the insider list for at least five years after it is drawn up or updated.
- Implementing Regulation (EU) 2026/1291, Articles 1(5) and 2(4): keep each person's personal data no longer than five years after they cease to be on the list. Article 1(3) asks for lists kept in electronic form with restricted access and with earlier versions still accessible.
- A hash chain cannot forget, so the ledger names people only by Atlassian account id. Names and professional phone numbers live in a separate store that can be erased person by person. The ledger keeps the history; the details can be deleted when their time is up.
- The regulation sets content and layout, not a file format. Each competent authority names its own transmission channel. Wall makes no outbound calls and never sends the list anywhere; the issuer does.

## Sources

- Commission Implementing Regulation (EU) 2026/1291, OJ L, 2026/1291, 15.6.2026: https://eur-lex.europa.eu/eli/reg_impl/2026/1291/oj/eng (ELI http://data.europa.eu/eli/reg_impl/2026/1291/oj; the same Official Journal text is served by the Publications Office at http://publications.europa.eu/resource/celex/32026R1291)
- Commission Implementing Regulation (EU) 2022/1210 (repealed 5 July 2026): https://eur-lex.europa.eu/eli/reg_impl/2022/1210/oj/eng
- Regulation (EU) No 596/2014, consolidated version of 5 June 2026: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02014R0596-20260605
- Regulation (EU) 2024/2809 (Listing Act): https://eur-lex.europa.eu/eli/reg/2024/2809/oj/eng
- ESMA final report on the extension of the alleviated insider-list format (ESMA74-268544963-1552, 21 October 2025): https://www.esma.europa.eu/document/final-report-draft-implementing-technical-standards-extension-use-alleviated-format
