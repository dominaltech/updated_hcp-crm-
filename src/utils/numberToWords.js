/**
 * Converts a numeric amount into Indian Currency Words.
 * e.g., 7950 -> "Rupees Seven Thousand Nine Hundred Fifty Only"
 * e.g., 10500.50 -> "Rupees Ten Thousand Five Hundred and Fifty Paise Only"
 */
export function numberToWordsINR(num) {
  const n = parseFloat(num);
  if (isNaN(n) || n === 0) return 'Rupees Zero Only';
  if (n < 0) return 'Minus ' + numberToWordsINR(Math.abs(n));

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];

  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function convertSection(val) {
    let str = '';
    if (val >= 100) {
      str += ones[Math.floor(val / 100)] + ' Hundred ';
      val %= 100;
    }
    if (val >= 20) {
      str += tens[Math.floor(val / 10)] + ' ';
      val %= 10;
    }
    if (val > 0) {
      str += ones[val] + ' ';
    }
    return str.trim();
  }

  const integerPart = Math.floor(n);
  const paise = Math.round((n - integerPart) * 100);

  let remaining = integerPart;
  const crores = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakhs = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousands = Math.floor(remaining / 1000);
  remaining %= 1000;
  const hundreds = remaining;

  let words = '';
  if (crores > 0) words += convertSection(crores) + ' Crore ';
  if (lakhs > 0) words += convertSection(lakhs) + ' Lakh ';
  if (thousands > 0) words += convertSection(thousands) + ' Thousand ';
  if (hundreds > 0) words += convertSection(hundreds) + ' ';

  words = words.trim();
  if (!words) words = 'Zero';

  let result = `Rupees ${words}`;
  if (paise > 0) {
    result += ` and ${convertSection(paise)} Paise`;
  }
  result += ' Only';

  return result.replace(/\s+/g, ' ');
}
