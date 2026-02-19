import Papa from 'papaparse';

/**
 * Robustly cleans money strings, handling both dots and commas as separators.
 * Handles: $1.234,56, $1,234.56, $1234.56, $1234,56, 1.234.000
 */
export const cleanMoneyString = (str) => {
    if (!str) return 0;
    let clean = str.toString().replace('$', '').trim();

    // If it has both , and .
    if (clean.includes(',') && clean.includes('.')) {
        if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
            // Latam style: 1.234,56
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else {
            // US style: 1,234.56
            clean = clean.replace(/,/g, '');
        }
    } else if (clean.includes(',')) {
        // Only commas. If it looks like a decimal (suffix is 3 chars e.g. ,00), assume decimal
        if (clean.length - clean.lastIndexOf(',') <= 3 && !clean.includes(',', clean.lastIndexOf(',') - 1)) {
            clean = clean.replace(',', '.');
        } else {
            // Thousands: 1,234,000
            clean = clean.replace(/,/g, '');
        }
    } else if (clean.includes('.')) {
        // Multiple dots -> definitely thousands: 1.234.000
        if ((clean.match(/\./g) || []).length > 1) {
            clean = clean.replace(/\./g, '');
        } else if (clean.length - clean.lastIndexOf('.') <= 3) {
            // Single dot at end (e.g. 1234.56) -> keep as decimal
        } else {
            // Single dot at start (e.g. 1.234) -> thousands
            clean = clean.replace(/\./g, '');
        }
    }

    return parseFloat(clean) || 0;
};

/**
 * Parses the "Planilla vieja VN" CSV format into structured student data.
 */
export const parsePilatesCSV = (csvString) => {
    return new Promise((resolve, reject) => {
        Papa.parse(csvString, {
            header: false,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const rows = results.data;
                    if (rows.length < 2) return resolve({ students: [], automaticExpenses: [] });

                    // Row 2 (index 1) contains months. Let's find them all by looking for labels.
                    const monthRow = rows[1];
                    const headerMonths = [];

                    // Standard columns: ID (0), Name (1), Entry (2), Class (3)
                    // We scan every column from 1 to find potential month starts
                    for (let col = 1; col < monthRow.length; col++) {
                        const val = monthRow[col] ? monthRow[col].toString().trim() : '';
                        if (val &&
                            !val.toUpperCase().includes('NOMBRE') &&
                            !val.toUpperCase().includes('INGRESO') &&
                            !val.toUpperCase().includes('CLASE') &&
                            !val.toUpperCase().includes('TEL')) {

                            // This is likely a month header marker (e.g. "febrero")
                            // Based on spreadsheet structure, data usually starts in the current or NEXT column
                            // We designate this column as the potential month start
                            headerMonths.push({ name: val, startIdx: col + 1 });

                            // Skip ahead to avoid picking up sub-headers or components of the same block
                            col += 2;
                        }
                    }

                    // Look for phone column
                    let phoneCol = -1;
                    rows[0].forEach((colName, idx) => {
                        if (colName && (colName.toUpperCase().includes('TEL') || colName.toUpperCase().includes('WHATS'))) {
                            phoneCol = idx;
                        }
                    });

                    const students = [];
                    const automaticExpenses = [];

                    // Data starts from row 3 (index 2)
                    for (let i = 2; i < rows.length; i++) {
                        const row = rows[i];
                        const id = row[0] ? row[0].toString().trim() : '';
                        const name = row[1] ? row[1].toString().trim() : '';

                        if ((!name && !id) || name === 'TOTAL' || name.includes('los que se fueron')) continue;

                        const student = {
                            id: id || `s-${i}`,
                            name: name || id || 'Sin Nombre',
                            entryDate: row[2] || '',
                            classesPerWeek: row[3] || '',
                            phone: phoneCol !== -1 ? (row[phoneCol] || '') : '',
                            history: []
                        };

                        // Map monthly data using headerMonths
                        headerMonths.forEach(m => {
                            if (row[m.startIdx] && row[m.startIdx].trim()) {
                                student.history.push({
                                    month: m.name,
                                    amount: row[m.startIdx].trim(),
                                    receivedBy: row[m.startIdx + 1] ? row[m.startIdx + 1].trim() : '',
                                    date: row[m.startIdx + 2] ? row[m.startIdx + 2].trim() : ''
                                });
                            }
                        });

                        const upperName = student.name.toUpperCase();
                        const upperId = id.toUpperCase();

                        // Metadata filtering
                        const isMetadata =
                            ((upperName.includes("HORAS") || upperId.includes("HORAS")) && !upperName.includes("GASTO")) ||
                            ((upperName.includes("SUELDO") || upperId.includes("SUELDO")) && !upperName.includes("GASTO")) ||
                            upperName.includes("ADELANTO") ||
                            upperName === "VANI" ||
                            upperName === "NICKI" ||
                            upperName === "GRACIELA DOBAL" ||
                            upperName === "DANIEL VIEIRA";

                        if (isMetadata) continue;

                        const hasHistory = student.history.length > 0;
                        const isGastoRow = upperName.includes("GASTO") || upperId.includes("GASTO");

                        if (isGastoRow && hasHistory) {
                            automaticExpenses.push(student);
                        } else if (student.id !== "0" && (student.classesPerWeek || hasHistory)) {
                            students.push(student);
                        }
                    }
                    resolve({ students, automaticExpenses });
                } catch (err) {
                    reject(err);
                }
            },
            error: (err) => reject(err)
        });
    });
};
