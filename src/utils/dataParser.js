import Papa from 'papaparse';

/**
 * Parses the "Planilla vieja VN" CSV format into structured student data.
 * The CSV has students starting from row 3, with monthly data in blocks.
 */
export const parsePilatesCSV = (csvString) => {
    return new Promise((resolve, reject) => {
        Papa.parse(csvString, {
            header: false,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const rows = results.data;
                    // Row 2 contains months. Let's find all of them dynamically.
                    const monthRow = rows[1];
                    const headerMonths = [];
                    const automaticExpenses = [];

                    // Month columns usually start at index 4 and repeat every 3 columns (Amount, ReceivedBy, Date)
                    // Let's also check if there is a 'TEL' column or similar
                    let phoneCol = -1;
                    rows[0].forEach((colName, idx) => {
                        if (colName && (colName.toUpperCase().includes('TEL') || colName.toUpperCase().includes('WHATS'))) {
                            phoneCol = idx;
                        }
                    });

                    for (let col = 4; col < monthRow.length; col += 3) {
                        const monthName = monthRow[col];
                        if (monthName && monthName.trim()) {
                            headerMonths.push({ name: monthName.trim(), startIdx: col });
                        }
                    }

                    const students = [];

                    // Students start from row 3 (index 2)
                    for (let i = 2; i < rows.length; i++) {
                        const row = rows[i];
                        const name = row[1];
                        if (!name || name === 'TOTAL' || name.includes('los que se fueron')) continue;

                        const student = {
                            id: row[0] || `s-${i}`,
                            name: name.trim(),
                            entryDate: row[2] || '',
                            classesPerWeek: row[3] || '',
                            phone: phoneCol !== -1 ? (row[phoneCol] || '') : '',
                            history: []
                        };

                        // Map monthly data
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

                        // Metadata filtering (Explicitly EXCLUDE GASTOS from here to catch them below)
                        const isMetadata =
                            (upperName.includes("HORAS") && !upperName.includes("GASTO")) ||
                            (upperName.includes("SUELDO") && !upperName.includes("GASTO")) ||
                            upperName.includes("ADELANTO") ||
                            upperName === "VANI" ||
                            upperName === "NICKI" ||
                            upperName === "GRACIELA DOBAL" ||
                            upperName === "DANIEL VIEIRA";

                        if (isMetadata) continue;

                        // Categorize: If name contains GASTO or has history but no classes/entry info, it's an Expense
                        const hasRecentHistory = student.history.length > 0;
                        const isGastoRow = upperName.includes("GASTO");

                        if (hasRecentHistory && (isGastoRow || (!student.classesPerWeek && !student.entryDate))) {
                            automaticExpenses.push(student);
                        } else if (student.id !== "0" && (student.classesPerWeek || hasRecentHistory)) {
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
