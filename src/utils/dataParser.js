import Papa from 'papaparse';

/**
 * Robustly cleans money strings, handling both dots and commas as separators.
 */
export const cleanMoneyString = (str) => {
    if (!str) return 0;
    let clean = str.toString().replace('$', '').trim();

    if (clean.includes(',') && clean.includes('.')) {
        if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else {
            clean = clean.replace(/,/g, '');
        }
    } else if (clean.includes(',')) {
        if (clean.length - clean.lastIndexOf(',') <= 3 && !clean.includes(',', clean.lastIndexOf(',') - 1)) {
            clean = clean.replace(',', '.');
        } else {
            clean = clean.replace(/,/g, '');
        }
    } else if (clean.includes('.')) {
        if ((clean.match(/\./g) || []).length > 1) {
            clean = clean.replace(/\./g, '');
        } else if (clean.length - clean.lastIndexOf('.') <= 3) {
            // Keep decimal
        } else {
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

                    // Month Row identification (usually row 2)
                    const monthRow = rows[1];
                    const headerMonths = [];

                    // Scan for month names. They mark the start of a [Amount, ReceivedBy, Date] block.
                    for (let col = 1; col < monthRow.length; col++) {
                        const val = monthRow[col] ? monthRow[col].toString().trim() : '';
                        if (val &&
                            !val.toUpperCase().includes('NOMBRE') &&
                            !val.toUpperCase().includes('INGRESO') &&
                            !val.toUpperCase().includes('CLASE') &&
                            !val.toUpperCase().includes('TEL') &&
                            val.length > 3) {

                            // DATA STARTS AT THE SAME COLUMN AS THE HEADER (Corrected index)
                            headerMonths.push({ name: val, startIdx: col });

                            // Skip ahead 2 columns to land after the current month block (Amount, Rec, Date)
                            col += 2;
                        }
                    }

                    let phoneCol = -1;
                    rows[0].forEach((colName, idx) => {
                        if (colName && (colName.toUpperCase().includes('TEL') || colName.toUpperCase().includes('WHATS'))) {
                            phoneCol = idx;
                        }
                    });

                    const students = [];
                    const automaticExpenses = [];

                    for (let i = 2; i < rows.length; i++) {
                        const row = rows[i];

                        // Check if row contains "GASTO" anywhere
                        let rowHasGastoKeyword = false;
                        let gastoNameParts = [];

                        row.forEach((cell, idx) => {
                            const cellStr = cell ? cell.toString().toUpperCase() : '';
                            if (cellStr.includes('GASTO')) {
                                rowHasGastoKeyword = true;
                            }
                            // Name parts extraction
                            if (idx < 5 && cell && typeof cell === 'string' && cell.length > 2) {
                                if (!cell.includes('$') && !cell.match(/[0-9]{2,}/)) {
                                    const cleanPart = cell.trim();
                                    if (!gastoNameParts.includes(cleanPart)) gastoNameParts.push(cleanPart);
                                }
                            }
                        });

                        const id = row[0] ? row[0].toString().trim() : '';
                        const name = row[1] ? row[1].toString().trim() : '';

                        // Row validation
                        if (!rowHasGastoKeyword && (!name && !id)) continue;
                        if (name.toUpperCase() === 'TOTAL' || name.toUpperCase().includes('LOS QUE SE FUERON')) continue;

                        const student = {
                            id: id || (name ? `s-${i}` : `g-${i}`),
                            name: name || (rowHasGastoKeyword ? gastoNameParts.join(' ') : id) || 'Sin Nombre',
                            entryDate: row[2] || '',
                            classesPerWeek: row[3] || '',
                            phone: phoneCol !== -1 ? (row[phoneCol] || '') : '',
                            history: []
                        };

                        // Map monthly history
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
                        const isGastoRow = rowHasGastoKeyword || upperName.includes("GASTO") || upperId.includes("GASTO");

                        if (isGastoRow && hasHistory) {
                            automaticExpenses.push(student);
                        } else if (student.id !== "0" && (name || id)) {
                            // More lenient: include anyone with a name or ID, regardless of history/classes
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
