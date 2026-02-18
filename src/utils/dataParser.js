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
                    // Row 2 contains months
                    const headerMonths = [
                        { name: rows[1][4], startIdx: 4 },
                        { name: rows[1][7], startIdx: 7 },
                        { name: rows[1][10], startIdx: 10 },
                        { name: rows[1][13], startIdx: 13 },
                        { name: rows[1][16], startIdx: 16 }
                    ];

                    const students = [];

                    // Students start from row 3
                    for (let i = 2; i < rows.length; i++) {
                        const row = rows[i];
                        const name = row[1];
                        if (!name || name === 'TOTAL' || name.includes('los que se fueron')) continue;

                        const student = {
                            id: row[0] || `s-${i}`,
                            name: name.trim(),
                            entryDate: row[2] || '',
                            classesPerWeek: row[3] || '',
                            history: []
                        };

                        // Map monthly data
                        headerMonths.forEach(m => {
                            if (row[m.startIdx]) {
                                student.history.push({
                                    month: m.name,
                                    amount: row[m.startIdx],
                                    receivedBy: row[m.startIdx + 1],
                                    date: row[m.startIdx + 2]
                                });
                            }
                        });

                        students.push(student);
                    }
                    resolve(students);
                } catch (err) {
                    reject(err);
                }
            },
            error: (err) => reject(err)
        });
    });
};
