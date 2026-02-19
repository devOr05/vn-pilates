import { useState, useEffect, useRef } from 'react'
import './App.css'
import { Plus, Search, Filter, History, Trash2, Pencil, Save, FileText, ChevronRight, User, DollarSign, Calendar, Clock, CreditCard, ChevronLeft, Check, X, MessageCircle, AlertCircle } from 'lucide-react'
import { parsePilatesCSV, cleanMoneyString } from './utils/dataParser'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import * as XLSX from 'xlsx'

function App() {
    const [students, setStudents] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoaded, setIsLoaded] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentStudentId, setPaymentStudentId] = useState(null);
    const [newPayment, setNewPayment] = useState({ month: '', amount: '', receivedBy: 'Vanina' });
    const [sheetLink, setSheetLink] = useState('');
    const [currentView, setCurrentView] = useState('alumnos'); // alumnos | reportes | ajustes
    const [toasts, setToasts] = useState([]);

    const showToast = (message, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    // Salary/Honorarios State
    const [salaryData, setSalaryData] = useState(() => {
        const saved = localStorage.getItem('vn_pilates_salary');
        return saved ? JSON.parse(saved) : {
            vanni: { hours: 0, hourlyValue: 0, advances: 0 },
            nicki: { hours: 0, hourlyValue: 0, advances: 0 }
        };
    });

    const [newStudent, setNewStudent] = useState({
        name: '',
        classesPerWeek: '2',
        entryDate: new Date().toISOString().split('T')[0],
        phone: '',
        initialAmount: '',
    });
    const [expensesData, setExpensesData] = useState(() => {
        const saved = localStorage.getItem('vn_pilates_expenses');
        return saved ? JSON.parse(saved) : [];
    });
    const [newExpense, setNewExpense] = useState({ description: '', amount: '' });
    const [editingExpenseId, setEditingExpenseId] = useState(null);
    const [editExpenseData, setEditExpenseData] = useState({ description: '', amount: '' });
    const [fileExpenses, setFileExpenses] = useState(() => {
        const saved = localStorage.getItem('vn_pilates_file_expenses');
        return saved ? JSON.parse(saved) : [];
    });
    const fileInputRef = useRef(null);

    // Persistence: Load on Mount
    useEffect(() => {
        const savedData = localStorage.getItem('vn_pilates_data');
        if (savedData) {
            setStudents(JSON.parse(savedData));
            setIsLoaded(true);
        }
    }, []);

    // Persistence: Save on Change
    useEffect(() => {
        if (isLoaded) {
            // Definitively filter out ghost students and metadata rows before saving
            const cleanStudents = students.filter(s => {
                const name = s.name.toUpperCase();
                return (
                    s.id !== "0" &&
                    name !== "GRACIELA DOBAL" &&
                    name !== "DANIEL VIEIRA" &&
                    !(name.includes("HORAS") && !name.includes("GASTO")) &&
                    !(name.includes("SUELDO") && !name.includes("GASTO")) &&
                    !name.includes("ADELANTO") &&
                    !name.includes("RESTO") &&
                    !(name === "VANI" || name === "NICKI" || name === "AGOSTO") &&
                    !name.includes("GASTO") &&
                    !s.id.toUpperCase().includes("GASTO")
                );
            });
            if (cleanStudents.length !== students.length) {
                setStudents(cleanStudents);
            }
            localStorage.setItem('vn_pilates_data', JSON.stringify(cleanStudents));
        }
    }, [students, isLoaded]);

    useEffect(() => {
        localStorage.setItem('vn_pilates_file_expenses', JSON.stringify(fileExpenses));
    }, [fileExpenses]);

    // Save Salary & Expenses Data
    useEffect(() => {
        localStorage.setItem('vn_pilates_salary', JSON.stringify(salaryData));
    }, [salaryData]);

    useEffect(() => {
        localStorage.setItem('vn_pilates_expenses', JSON.stringify(expensesData));
    }, [expensesData]);

    const handleLinkImport = async () => {
        if (!sheetLink) return;

        let csvUrl = sheetLink;

        // Robust Google Sheets link transformation
        if (sheetLink.includes('/pubhtml')) {
            // Handle "Publish to the web" links
            csvUrl = sheetLink.replace('/pubhtml', '/pub?output=csv');
        } else {
            const idMatch = sheetLink.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (idMatch && idMatch[1]) {
                csvUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
            } else if (!csvUrl.includes('/export') && !csvUrl.includes('/pub')) {
                alert('Por favor, asegúrate de que el link sea de una planilla de Google Sheets válida.');
                return;
            }
        }

        try {
            // Attempt direct fetch first with a fallback to proxy for CORS issues
            let response;
            try {
                response = await fetch(csvUrl);
                if (!response.ok) throw new Error('Fetch failed');
            } catch (e) {
                // Use AllOrigins proxy as fallback to bypass CORS
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(csvUrl)}`;
                response = await fetch(proxyUrl);
            }

            if (!response.ok) throw new Error('No se pudo acceder al link. Asegúrate de que la planilla esté compartida con "Cualquier persona con el vínculo".');

            const text = await response.text();
            const { students: parsedStudents, automaticExpenses } = await parsePilatesCSV(text);

            if (!parsedStudents || parsedStudents.length === 0) throw new Error('No se encontraron alumnos válidos en este archivo.');

            setStudents(parsedStudents);
            setFileExpenses(automaticExpenses);
            setIsLoaded(true);
            setShowLinkModal(false);
            setSheetLink('');
            showToast('¡Datos sincronizados desde el link con éxito!');
        } catch (error) {
            console.error('Error link import:', error);
            showToast(`Error de sincronización: ${error.message}\n\nSi el error persiste, asegúrate de que la planilla esté compartida con "Cualquier persona con el vínculo" o usa la opción "Importar CSV" descargando el archivo.`, 'error');
        }
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Check if it's a Google Sheets link (not a real CSV)
        if (file.name.toLowerCase().endsWith('.gsheet')) {
            showToast('Error: Este archivo es un "Acceso directo de Google Sheets". Para cargarlo, debes abrir el archivo en Google Sheets y descargarlo como CSV (Archivo > Descargar > Valores separados por comas).', 'error');
            return;
        }

        // Check if it's actually a CSV (lenient check to help with Drive files)
        const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';

        if (!isCSV && file.type !== "") {
            if (!window.confirm(`El archivo "${file.name}" no parece un CSV estándar. ¿Deseas intentar cargarlo de todas formas?`)) {
                return;
            }
        }

        try {
            const text = await file.text();
            if (!text || text.trim().length === 0) {
                throw new Error('El archivo está vacío');
            }

            const { students: parsedStudents, automaticExpenses } = await parsePilatesCSV(text);
            if (!parsedStudents || parsedStudents.length === 0) {
                throw new Error('No se encontraron alumnos válidos en el archivo');
            }

            setStudents(parsedStudents);
            setFileExpenses(automaticExpenses);
            setIsLoaded(true);
            showToast('¡Datos cargados con éxito!');
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            showToast(`Error al procesar el archivo: ${error.message}. Asegúrate de que sea el formato de exportación esperado.`, 'error');
        }
    };

    const addStudent = () => {
        if (!newStudent.name) return;
        const student = {
            id: `manual-${Date.now()}`,
            name: newStudent.name,
            classesPerWeek: newStudent.classesPerWeek,
            entryDate: newStudent.entryDate,
            phone: newStudent.phone,
            history: newStudent.initialAmount ? [{
                month: new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
                amount: newStudent.initialAmount.startsWith('$') ? newStudent.initialAmount : `$${newStudent.initialAmount}`,
                receivedBy: newStudent.initialReceiver,
                date: new Date().toLocaleDateString('es-ES')
            }] : []
        };
        setStudents([student, ...students]);
        setNewStudent({
            name: '',
            classesPerWeek: '2',
            entryDate: new Date().toISOString().split('T')[0],
            phone: '',
            initialAmount: '',
            initialReceiver: 'Vanina'
        });
        setShowAddModal(false);
        showToast("Alumno agregado correctamente");
    };

    const handleResetData = () => {
        if (window.confirm('⚠️ ¿ESTÁS SEGURO? Esta acción borrará TODOS los alumnos y pagos permanentemente. No se puede deshacer.')) {
            setStudents([]);
            localStorage.removeItem('vn_pilates_data');
            setIsLoaded(false);
            setCurrentView('alumnos');
            showToast('Base de datos borrada correctamente.', 'error');
        }
    };

    const deleteStudent = (studentId, event) => {
        event.stopPropagation();
        if (window.confirm('¿Estás seguro de eliminar este alumno?')) {
            setStudents(students.filter(s => s.id !== studentId));
            showToast("Alumno eliminado", "error");
        }
    };

    const hasPaidCurrentMonth = (student) => {
        if (!student.history || student.history.length === 0) return false;
        const now = new Date();
        const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const currentMonthName = months[now.getMonth()];
        const currentMonthNum = (now.getMonth() + 1).toString().padStart(2, '0');
        const currentYearShort = now.getFullYear().toString().slice(-2);

        // Match "febrero", "febrero 24", "02/24", etc.
        return student.history.some(h => {
            const m = h.month.toLowerCase();
            return m.includes(currentMonthName) ||
                m.includes(`${currentMonthNum}/${currentYearShort}`) ||
                (m.includes(currentMonthName) && m.includes(currentYearShort));
        });
    };

    const addPayment = (studentId) => {
        setPaymentStudentId(studentId);
        const now = new Date();
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const currentMonth = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
        setNewPayment({ month: currentMonth, amount: '', receivedBy: 'Vanina' });
        setShowPaymentModal(true);
    };

    const confirmPayment = () => {
        const { month, amount, receivedBy } = newPayment;
        if (!month || !amount) return;

        const updatedStudents = students.map(s => {
            if (s.id === paymentStudentId) {
                const updatedStudent = {
                    ...s,
                    history: [{
                        month,
                        amount: amount.startsWith('$') ? amount : `$${amount}`,
                        receivedBy,
                        date: new Date().toLocaleDateString('es-ES')
                    }, ...s.history]
                };
                // Update selected student if viewing matches
                if (selectedStudent && selectedStudent.id === paymentStudentId) {
                    setSelectedStudent(updatedStudent);
                }
                return updatedStudent;
            }
            return s;
        });

        setStudents(updatedStudents);
        showToast("Pago agregado correctamente");
    };

    const saveStudentChanges = () => {
        if (!selectedStudent) return;
        setStudents(students.map(s => s.id === selectedStudent.id ? selectedStudent : s));
        showToast("Cambios guardados con éxito");
    };

    const updateStudentField = (field, value) => {
        setSelectedStudent({ ...selectedStudent, [field]: value });
    };

    const calculateTotals = () => {
        let totalMoney = 0;
        let totalClasses = 0;
        let vanniMoney = 0;
        let nickiMoney = 0;
        let totalPayments = 0;

        students.forEach(s => {
            totalClasses += parseInt(s.classesPerWeek) || 0;
            s.history.forEach(h => {
                const amount = cleanMoneyString(h.amount);
                totalMoney += amount;
                totalPayments++;
                if (h.receivedBy?.toLowerCase().includes('vani')) vanniMoney += amount;
                if (h.receivedBy?.toLowerCase().includes('nic')) nickiMoney += amount;
            });
        });

        const activeStudents = students.filter(s => s.history.length > 0).length;
        const averagePerStudent = activeStudents ? totalMoney / activeStudents : 0;

        const manualExpenses = expensesData.reduce((acc, exp) => acc + (parseFloat(exp.amount) || 0), 0);

        // Sum automatic expenses (filter for the MOST RECENT entry in the history array)
        const autoExpensesValue = fileExpenses.reduce((acc, exp) => {
            const latestPayment = exp.history[exp.history.length - 1];
            const amount = latestPayment ? cleanMoneyString(latestPayment.amount) : 0;
            return acc + amount;
        }, 0);

        const totalExpenses = manualExpenses + autoExpensesValue;

        return { totalMoney, totalClasses, vanniMoney, nickiMoney, totalPayments, activeStudents, averagePerStudent, totalExpenses };
    };

    const totals = calculateTotals();

    const exportToExcel = (type = 'alumnos') => {
        let headers = [];
        let rows = [];
        let filename = "";

        if (type === 'alumnos') {
            headers = ["ID", "NOMBRE", "INGRESO", "CLASES/SEM", "TELEFONO"];
            // Get last 5 months for columns
            const monthsSet = new Set();
            students.forEach(s => s.history.forEach(h => monthsSet.add(h.month)));
            const activeMonths = Array.from(monthsSet).slice(-5);
            activeMonths.forEach(m => headers.push(m, "Recibió", "Fecha"));

            rows = students.map(s => {
                const row = [s.id, s.name, s.entryDate, s.classesPerWeek, s.phone || ''];
                activeMonths.forEach(m => {
                    const payment = s.history.find(h => h.month === m);
                    if (payment) {
                        row.push(payment.amount, payment.receivedBy, payment.date);
                    } else {
                        row.push("", "", "");
                    }
                });
                return row;
            });
            filename = `Alumnos-VN-Pilates-${new Date().toISOString().split('T')[0]}.xlsx`;
        } else {
            // Report Excel
            headers = ["MES", "RECIBIDO POR", "CONCEPTO", "ALUMNO", "MONTO"];
            students.forEach(s => {
                s.history.forEach(h => {
                    rows.push([h.month, h.receivedBy, "Pago Cuota", s.name, h.amount]);
                });
            });
            // Add Salary rows to report excel
            rows.push([]);
            rows.push(["RESUMEN DE HONORARIOS"]);
            rows.push(["PROFESOR", "HORAS", "VALOR HORA", "SUELDO BRUTO", "ADELANTOS", "RESTO A PAGAR"]);
            ['vanni', 'nicki'].forEach(p => {
                const d = salaryData[p];
                const sueldo = d.hours * d.hourlyValue;
                rows.push([p.toUpperCase(), d.hours, `$ ${d.hourlyValue.toLocaleString()}`, `$ ${sueldo.toLocaleString()}`, `$ ${d.advances.toLocaleString()}`, `$ ${(sueldo - d.advances).toLocaleString()}`]);
            });

            // Add Expenses section
            rows.push([]);
            rows.push(["RESUMEN DE GASTOS (MANUALES + PLANILLA)"]);
            rows.push(["DESCRIPCIÓN / CONCEPTO", "MONTO", "ORIGEN / RECIBIÓ", "FECHA"]);

            // Manual
            expensesData.forEach(exp => {
                rows.push([exp.description, `$ ${parseFloat(exp.amount).toLocaleString()}`, "Carga Manual", new Date().toLocaleDateString('es-ES')]);
            });

            // File
            fileExpenses.forEach(exp => {
                const latest = exp.history[exp.history.length - 1];
                if (latest) {
                    rows.push([exp.name, latest.amount, latest.receivedBy || 'Planilla', latest.date]);
                }
            });

            rows.push(["TOTAL CONSOLIDADO DE GASTOS", `$ ${totals.totalExpenses.toLocaleString()}`]);

            // Final Summary Balance
            rows.push([]);
            rows.push(["BALANCE FINAL"]);
            rows.push(["INGRESOS TOTALES", `$ ${totals.totalMoney.toLocaleString()}`]);
            rows.push(["GASTOS TOTALES", `$ ${totals.totalExpenses.toLocaleString()}`]);
            rows.push(["GANANCIA NETA", `$ ${(totals.totalMoney - totals.totalExpenses).toLocaleString()}`]);

            filename = `Reporte-Finanzas-Pilates-${new Date().toISOString().split('T')[0]}.xlsx`;
        }

        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, type === 'alumnos' ? "Alumnos" : "Reporte");
        XLSX.writeFile(workbook, filename);
    };

    const exportToPDF = () => {
        const doc = new jsPDF();

        // Add Title
        doc.setFontSize(18);
        doc.text("Resumen de Gestión VN Pilates", 14, 20);
        doc.setFontSize(11);
        doc.text(`Fecha de generación: ${new Date().toLocaleDateString()}`, 14, 30);

        // Financial Summary Table
        const financialHeaders = [["Concepto", "Valor"]];
        const financialData = [
            ["Recaudación Total", `$${totals.totalMoney.toLocaleString()}`],
            ["Total Alumnos", students.length.toString()],
            ["Total Clases por Sem.", totals.totalClasses.toString()],
            ["Recibió Vanni", `$${totals.vanniMoney.toLocaleString()}`],
            ["Recibió Nicki", `$${totals.nickiMoney.toLocaleString()}`]
        ];

        doc.autoTable({
            startY: 40,
            head: financialHeaders,
            body: financialData,
            theme: 'striped',
            headStyles: { fillStyle: '#6366f1' }
        });

        // Salary Table
        doc.setFontSize(14);
        doc.text("Resumen de Honorarios", 14, doc.lastAutoTable.finalY + 15);
        const salaryHeaders = [["Personal", "Horas", "Valor Hora", "Bruto", "Adelanto", "Neto"]];
        const salaryRows = ['vanni', 'nicki'].map(p => {
            const d = salaryData[p];
            const sueldo = d.hours * d.hourlyValue;
            return [p.toUpperCase(), `${d.hours}hs`, `$${d.hourlyValue.toLocaleString()}`, `$${sueldo.toLocaleString()}`, `$${d.advances.toLocaleString()}`, `$${(sueldo - d.advances).toLocaleString()}`];
        });

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 20,
            head: salaryHeaders,
            body: salaryRows,
            theme: 'grid',
            headStyles: { fillStyle: '#10b981' }
        });

        // Expenses Table
        doc.setFontSize(14);
        doc.text("Resumen Mensual de Gastos", 14, doc.lastAutoTable.finalY + 15);
        const expenseHeaders = [["Concepto", "Monto", "Origen", "Fecha"]];
        const expenseRows = [];
        expensesData.forEach(exp => expenseRows.push([exp.description, `$${parseFloat(exp.amount).toLocaleString()}`, "Manual", new Date().toLocaleDateString('es-ES')]));
        fileExpenses.forEach(exp => {
            const l = exp.history[exp.history.length - 1];
            if (l) expenseRows.push([exp.name, l.amount, l.receivedBy || 'Planilla', l.date]);
        });
        expenseRows.push([{ content: 'TOTAL CONSOLIDADO', styles: { fontStyle: 'bold' } }, { content: `$${totals.totalExpenses.toLocaleString()}`, styles: { fontStyle: 'bold', textColor: [239, 68, 68] } }, '', '']);

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 20,
            head: expenseHeaders,
            body: expenseRows,
            theme: 'striped'
        });

        // Final Balance
        doc.setFontSize(16);
        const finalY = doc.lastAutoTable.finalY + 20;
        doc.text(`GANANCIA NETA FINAL: $${(totals.totalMoney - totals.totalExpenses).toLocaleString()}`, 14, finalY);

        // Students Table (Lower priority, separate page if needed or just below)
        doc.addPage();
        doc.setFontSize(14);
        doc.text("Listado Detallado de Alumnos", 14, 20);

        const studentHeaders = [["Nombre", "Clases/Sem", "Ingreso", "Último Pago"]];
        const studentData = students.map(s => [
            s.name,
            s.classesPerWeek,
            s.entryDate,
            s.history.length > 0 ? `${s.history[0].month} (${s.history[0].amount})` : '-'
        ]);

        doc.autoTable({
            startY: 30,
            head: studentHeaders,
            body: studentData,
            theme: 'grid'
        });

        doc.save(`VN-Pilates-Reporte-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    const exportStudentPDF = (student) => {
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text(`Ficha de Alumno: ${student.name}`, 14, 20);

        doc.setFontSize(11);
        doc.text(`Clases por semana: ${student.classesPerWeek}`, 14, 30);
        doc.text(`Fecha de ingreso: ${student.entryDate}`, 14, 35);

        const historyHeaders = [["Mes", "Monto", "Recibió", "Fecha de Pago"]];
        const historyData = student.history.map(h => [
            h.month, h.amount, h.receivedBy, h.date
        ]);

        doc.autoTable({
            startY: 45,
            head: historyHeaders,
            body: historyData,
            theme: 'striped',
            headStyles: { fillStyle: '#6366f1' }
        });

        doc.save(`Ficha-${student.name.replace(/\s+/g, '-')}.pdf`);
    };

    const filteredStudents = students.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        s.id !== "0" &&
        s.name.toUpperCase() !== "GRACIELA DOBAL" &&
        s.name.toUpperCase() !== "DANIEL VIEIRA"
    );

    if (selectedStudent) {
        return (
            <div className="app-container">
                <aside className="sidebar">
                    <div className="logo-section">
                        <h1>VN Pilates</h1>
                        <span className="beta-label">v1.0 Beta</span>
                    </div>
                    <nav className="nav-menu">
                        <div className="nav-group">
                            <button
                                className={`nav-item ${currentView === 'alumnos' ? 'active' : ''}`}
                                onClick={() => { setCurrentView('alumnos'); setSelectedStudent(null); }}
                            >
                                <User size={22} /> <span>Alumnos</span>
                            </button>
                            <button
                                className={`nav-item ${currentView === 'reportes' ? 'active' : ''}`}
                                onClick={() => { setCurrentView('reportes'); setSelectedStudent(null); }}
                            >
                                <FileText size={22} /> <span>Reportes</span>
                            </button>
                        </div>

                        <div className="nav-group separator">
                            <label className="nav-label">Importar</label>
                            <button className="nav-item action" onClick={() => fileInputRef.current.click()}>
                                <Save size={20} /> <span>Importar CSV</span>
                            </button>
                            <button className="nav-item action" onClick={() => setShowLinkModal(true)}>
                                <Plus size={20} /> <span>Importar por Link</span>
                            </button>
                        </div>

                        <div className="nav-group bottom">
                            <button
                                className={`nav-item ${currentView === 'ajustes' ? 'active' : ''}`}
                                onClick={() => { setCurrentView('ajustes'); setSelectedStudent(null); }}
                            >
                                <Filter size={22} /> <span>Ajustes</span>
                            </button>
                        </div>
                    </nav>
                </aside>

                <main className="main-content">
                    <header className="main-header">
                        <button className="btn-back" onClick={() => { setSelectedStudent(null); setSearchTerm(''); }}>
                            <ChevronLeft size={20} /> Volver al listado
                        </button>
                        <div className="header-actions">
                            <button className="btn-secondary" onClick={() => exportStudentPDF(selectedStudent)} title="Exportar Ficha PDF">
                                <FileText size={18} />
                            </button>
                            <button className="btn-secondary" onClick={() => alert('Módulo de Ficha Médica en desarrollo')}>
                                <span>Ficha Médica</span>
                            </button>
                            <button className="btn-save" onClick={saveStudentChanges}><Save size={18} /> Guardar</button>
                        </div>
                    </header>

                    <section className="student-profile">
                        <div className="profile-header">
                            <div className="avatar">
                                <User size={40} />
                            </div>
                            <div className="profile-info">
                                <input
                                    className="edit-name"
                                    value={selectedStudent.name}
                                    onChange={(e) => updateStudentField('name', e.target.value)}
                                />
                                <div className="badges">
                                    <div className="badge-input">
                                        <label>Clases/Sem:</label>
                                        <input
                                            type="number"
                                            value={selectedStudent.classesPerWeek}
                                            onChange={(e) => updateStudentField('classesPerWeek', e.target.value)}
                                        />
                                    </div>
                                    <div className="badge-input">
                                        <label>Desde:</label>
                                        <input
                                            type="text"
                                            value={selectedStudent.entryDate}
                                            onChange={(e) => updateStudentField('entryDate', e.target.value)}
                                        />
                                    </div>
                                    <div className="badge-input">
                                        <label>Tel:</label>
                                        <input
                                            type="text"
                                            value={selectedStudent.phone || ''}
                                            onChange={(e) => updateStudentField('phone', e.target.value)}
                                            placeholder="Telefono..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="history-section">
                            <h3>Historial de Pagos</h3>
                            <div className="history-cards">
                                {selectedStudent.history.length > 0 ? (
                                    selectedStudent.history.map((item, idx) => (
                                        <div key={idx} className="payment-card">
                                            <div className="card-header">
                                                <span className="month-tag">{item.month}</span>
                                                <span className="status-tag paid">Pagado</span>
                                            </div>
                                            <div className="card-body">
                                                <div className="detail">
                                                    <DollarSign size={16} />
                                                    <span>{item.amount}</span>
                                                </div>
                                                <div className="detail">
                                                    <User size={16} />
                                                    <span>Recibió: {item.receivedBy}</span>
                                                </div>
                                                {item.date && (
                                                    <div className="detail">
                                                        <Calendar size={16} />
                                                        <span>Fecha: {item.date}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="no-data">Sin historial registrado</p>
                                )}
                                <button className="add-payment-card" onClick={() => addPayment(selectedStudent.id)}>
                                    <Plus size={24} />
                                    <span>Nuevo Pago</span>
                                </button>
                            </div>
                        </div>
                    </section>
                </main>
            </div>
        );
    }

    return (
        <div className="app-container">
            <aside className="sidebar">
                <div className="logo-section">
                    <h1>VN Pilates</h1>
                    <span className="beta-label">v1.0 Beta</span>
                </div>
                <nav className="nav-menu">
                    <div className="nav-group">
                        <button
                            className={`nav-item ${currentView === 'alumnos' ? 'active' : ''}`}
                            onClick={() => setCurrentView('alumnos')}
                        >
                            <User size={22} /> <span>Alumnos</span>
                        </button>
                        <button
                            className={`nav-item ${currentView === 'reportes' ? 'active' : ''}`}
                            onClick={() => setCurrentView('reportes')}
                        >
                            <FileText size={22} /> <span>Reportes</span>
                        </button>
                    </div>

                    <div className="nav-group separator">
                        <label className="nav-label">Importar</label>
                        <button className="nav-item action" onClick={() => fileInputRef.current.click()}>
                            <Save size={20} /> <span>Importar CSV</span>
                        </button>
                        <button className="nav-item action" onClick={() => setShowLinkModal(true)}>
                            <Plus size={20} /> <span>Importar por Link</span>
                        </button>
                    </div>

                    <div className="nav-group bottom">
                        <button
                            className={`nav-item ${currentView === 'ajustes' ? 'active' : ''}`}
                            onClick={() => setCurrentView('ajustes')}
                        >
                            <Filter size={22} /> <span>Ajustes</span>
                        </button>
                    </div>
                </nav>
            </aside>

            <main className="main-content">
                <header className="main-header">
                    {currentView === 'alumnos' ? (
                        <div className="search-bar">
                            <Search size={18} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Buscar alumno..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    ) : (
                        <h2>Reportes de Gestión</h2>
                    )}
                    {currentView === 'alumnos' && (
                        <button className="btn-add" onClick={() => setShowAddModal(true)}><Plus size={18} /> Nuevo Alumno</button>
                    )}
                </header>

                <section className="dashboard">
                    {currentView === 'alumnos' ? (
                        <div className="student-list-container">
                            <div className="list-header">
                                <h3>Listado de Alumnos ({filteredStudents.length})</h3>
                                <div className="list-actions">
                                    {isLoaded && <button className="btn-secondary" onClick={() => exportToExcel('alumnos')}>Exportar Excel</button>}
                                    {!isLoaded && (
                                        <button className="btn-upload" onClick={() => fileInputRef.current.click()}>
                                            Importar planilla
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    /* Removed accept attribute to prevent files from being grayed out on Some Drive/Windows setups */
                                    style={{ display: 'none' }}
                                />
                            </div>

                            <div className="student-grid">
                                {isLoaded ? (
                                    filteredStudents.map(student => (
                                        <div key={student.id} className="student-card" onClick={() => setSelectedStudent(student)}>
                                            <div className="student-avatar">
                                                {student.name.charAt(0)}
                                            </div>
                                            <div className="student-meta">
                                                <div className="name-row">
                                                    <h4>{student.name}</h4>
                                                    <div className="mini-actions">
                                                        {hasPaidCurrentMonth(student) ? (
                                                            <div className="mini-icon check" title="Pago al día">
                                                                <Check size={14} />
                                                            </div>
                                                        ) : (
                                                            <div className="mini-icon pending" title="Pago pendiente">
                                                                <Clock size={14} />
                                                            </div>
                                                        )}
                                                        {student.phone && (
                                                            <a
                                                                href={`https://wa.me/${student.phone.replace(/\D/g, '')}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="mini-icon whatsapp"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <MessageCircle size={14} />
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                                <p>{student.classesPerWeek} veces por semana</p>
                                            </div>
                                            <div className="card-right-actions">
                                                <button
                                                    className="action-icon delete"
                                                    onClick={(e) => deleteStudent(student.id, e)}
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                                <ChevronRight size={18} className="arrow" />
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="empty-state">
                                        <div className="icon-box highlight">
                                            <FileText size={48} />
                                        </div>
                                        <div className="text-box">
                                            <h3>Bienvenido a VN Pilates</h3>
                                            <p>Aún no hay datos cargados en esta computadora.</p>
                                            <span>Por favor, sube el archivo de gestión para comenzar.</span>
                                        </div>
                                        <button className="btn-primary-large" onClick={() => fileInputRef.current.click()}>
                                            Importar Planilla VN (.csv)
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : currentView === 'reportes' ? (
                        <div className="reports-container">
                            <div className="report-card main-summary">
                                <div className="report-header">
                                    <div className="report-title-group">
                                        <h3>Resumen de Gestión Geral</h3>
                                        <p className="report-subtitle">Datos consolidados de todos los alumnos</p>
                                    </div>
                                    <div className="report-header-buttons">
                                        <button className="btn-secondary" onClick={() => exportToExcel('reporte')}>
                                            <Save size={16} /> Excel
                                        </button>
                                        <button className="btn-secondary" onClick={exportToPDF}>
                                            <FileText size={16} /> PDF
                                        </button>
                                    </div>
                                </div>

                                <div className="report-stats">
                                    <div className="report-stat-card primary">
                                        <div className="stat-label">Ingresos Totales</div>
                                        <div className="stat-value">$ {totals.totalMoney.toLocaleString()}</div>
                                        <div className="stat-delta">{totals.activeStudents} cuotas cobradas</div>
                                    </div>
                                    <div className="report-stat-card danger">
                                        <div className="stat-label">Gastos Totales</div>
                                        <div className="stat-value">$ {totals.totalExpenses.toLocaleString()}</div>
                                        <div className="stat-delta">Costos de este mes</div>
                                    </div>
                                    <div className="report-stat-card success">
                                        <div className="stat-label">Ganancia Neta</div>
                                        <div className="stat-value">$ {(totals.totalMoney - totals.totalExpenses).toLocaleString()}</div>
                                        <div className="stat-delta">Balance final</div>
                                    </div>
                                </div>
                            </div>

                            <div className="report-card honorarios-section">
                                <div className="section-header">
                                    <h3>Honorarios y Horas</h3>
                                    <span>{new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</span>
                                </div>
                                <div className="salary-grid">
                                    {['vanni', 'nicki'].map(person => {
                                        const data = salaryData[person];
                                        const sueldo = data.hours * data.hourlyValue;
                                        const resto = sueldo - data.advances;
                                        return (
                                            <div key={person} className={`salary-card ${person}`}>
                                                <div className="card-header">
                                                    <h4>{person.toUpperCase()}</h4>
                                                </div>
                                                <div className="salary-inputs">
                                                    <div className="input-group">
                                                        <label>Horas Trabajadas</label>
                                                        <input
                                                            type="number"
                                                            value={data.hours}
                                                            onChange={e => setSalaryData({ ...salaryData, [person]: { ...data, hours: parseFloat(e.target.value) || 0 } })}
                                                        />
                                                    </div>
                                                    <div className="input-group">
                                                        <label>Valor de la Hora</label>
                                                        <div className="with-prefix">
                                                            <span>$</span>
                                                            <input
                                                                type="number"
                                                                value={data.hourlyValue}
                                                                onChange={e => setSalaryData({ ...salaryData, [person]: { ...data, hourlyValue: parseFloat(e.target.value) || 0 } })}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="input-group">
                                                        <label>Adelantos</label>
                                                        <div className="with-prefix">
                                                            <span>$</span>
                                                            <input
                                                                type="number"
                                                                value={data.advances}
                                                                onChange={e => setSalaryData({ ...salaryData, [person]: { ...data, advances: parseFloat(e.target.value) || 0 } })}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="salary-results">
                                                    <div className="result-row">
                                                        <span>Sueldo Bruto</span>
                                                        <strong>${sueldo.toLocaleString()}</strong>
                                                    </div>
                                                    <div className="result-row highlight">
                                                        <span>Resto a pagar</span>
                                                        <strong>${resto.toLocaleString()}</strong>
                                                    </div>
                                                </div>
                                                <button
                                                    className="btn-save-salary"
                                                    onClick={() => showToast(`Datos de ${person.toUpperCase()} guardados con éxito`)}
                                                >
                                                    Guardar Datos
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Gastos Section */}
                            <div className="report-card">
                                <div className="card-header">
                                    <div className="header-info">
                                        <h3>Gestión de Gastos (Gastos Operativos)</h3>
                                        <p className="report-subtitle">Registra aquí los egresos del mes</p>
                                    </div>
                                    <div className="expense-form">
                                        <input
                                            type="text"
                                            placeholder="Descripción del gasto..."
                                            value={newExpense.description}
                                            onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                                        />
                                        <input
                                            type="number"
                                            placeholder="Monto $"
                                            value={newExpense.amount}
                                            onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                                        />
                                        <button className="btn-add" onClick={() => {
                                            if (!newExpense.description || !newExpense.amount) return;
                                            setExpensesData([...expensesData, { ...newExpense, id: Date.now() }]);
                                            setNewExpense({ description: '', amount: '' });
                                            showToast("Gasto agregado");
                                        }}>
                                            <Plus size={18} /> Agregar
                                        </button>
                                    </div>
                                </div>
                                <div className="expenses-list">
                                    {expensesData.length > 0 ? (
                                        <table className="full-data-table expense-table">
                                            <thead>
                                                <tr>
                                                    <th>Descripción</th>
                                                    <th>Monto</th>
                                                    <th style={{ width: '50px' }}>Acción</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {expensesData.map(exp => (
                                                    <tr key={exp.id}>
                                                        {editingExpenseId === exp.id ? (
                                                            <>
                                                                <td>
                                                                    <input
                                                                        type="text"
                                                                        className="edit-input"
                                                                        value={editExpenseData.description}
                                                                        onChange={e => setEditExpenseData({ ...editExpenseData, description: e.target.value })}
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        type="number"
                                                                        className="edit-input"
                                                                        value={editExpenseData.amount}
                                                                        onChange={e => setEditExpenseData({ ...editExpenseData, amount: e.target.value })}
                                                                    />
                                                                </td>
                                                                <td className="actions-cell">
                                                                    <button className="btn-icon-success" onClick={() => {
                                                                        setExpensesData(expensesData.map(e => e.id === exp.id ? { ...e, ...editExpenseData } : e));
                                                                        setEditingExpenseId(null);
                                                                    }}>
                                                                        <Check size={16} />
                                                                    </button>
                                                                    <button className="btn-icon-secondary" onClick={() => setEditingExpenseId(null)}>
                                                                        <X size={16} />
                                                                    </button>
                                                                </td>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <td data-label="Descripción">{exp.description}</td>
                                                                <td data-label="Monto">$ {parseFloat(exp.amount).toLocaleString()}</td>
                                                                <td className="actions-cell" data-label="Acción">
                                                                    <button className="btn-icon-secondary" onClick={() => {
                                                                        setEditingExpenseId(exp.id);
                                                                        setEditExpenseData({ description: exp.description, amount: exp.amount });
                                                                    }}>
                                                                        <Pencil size={16} />
                                                                    </button>
                                                                    <button className="btn-icon-danger" onClick={() => setExpensesData(expensesData.filter(e => e.id !== exp.id))}>
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </td>
                                                            </>
                                                        )}
                                                    </tr>
                                                ))}
                                                <tr className="total-row">
                                                    <td><strong>TOTAL GASTOS</strong></td>
                                                    <td colSpan="2"><strong>$ {totals.totalExpenses.toLocaleString()}</strong></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    ) : (
                                        <p className="no-data">No hay gastos registrados este mes.</p>
                                    )}
                                </div>
                            </div>

                            <div className="report-table-section">
                                <div className="section-header">
                                    <h4>Detalle Completo de Alumnos</h4>
                                    <span>{students.length} registros cargados</span>
                                </div>
                                <div className="table-wrapper">
                                    <table className="full-data-table">
                                        <thead>
                                            <tr>
                                                <th>Nombre</th>
                                                <th>Ingreso</th>
                                                <th>Clases</th>
                                                <th>Último Mes</th>
                                                <th>Monto</th>
                                                <th>Recibió</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {students.map(s => (
                                                <tr key={s.id}>
                                                    <td data-label="Nombre">{s.name}</td>
                                                    <td data-label="Ingreso">{s.entryDate}</td>
                                                    <td data-label="Clases">{s.classesPerWeek}</td>
                                                    <td data-label="Último Mes">{s.history[0]?.month || '-'}</td>
                                                    <td data-label="Monto">{s.history[0]?.amount || '-'}</td>
                                                    <td data-label="Recibió">{s.history[0]?.receivedBy || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="report-card honorarios-summary">
                                <h3>Resumen de Sueldos - {new Date().toLocaleDateString('es-ES', { month: 'long' }).toUpperCase()} {new Date().getFullYear()}</h3>
                                <div className="table-wrapper">
                                    <table className="full-data-table summary-table">
                                        <thead>
                                            <tr>
                                                <th>PERSONAL</th>
                                                <th>HORAS</th>
                                                <th>VALOR HORA</th>
                                                <th>SUELDO BRUTO</th>
                                                <th>ADELANTO</th>
                                                <th>RESTO A PAGAR</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {['vanni', 'nicki'].map(p => {
                                                const d = salaryData[p];
                                                const sueldo = d.hours * d.hourlyValue;
                                                return (
                                                    <tr key={p}>
                                                        <td><strong>{p.toUpperCase()}</strong></td>
                                                        <td>{d.hours}hs</td>
                                                        <td>$ {d.hourlyValue.toLocaleString()}</td>
                                                        <td>$ {sueldo.toLocaleString()}</td>
                                                        <td>$ {d.advances.toLocaleString()}</td>
                                                        <td className="amount-highlight">$ {(sueldo - d.advances).toLocaleString()}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="report-card honorarios-summary">
                                <h3>Resumen Mensual de Gastos (Planilla + Manuales) - {new Date().toLocaleDateString('es-ES', { month: 'long' }).toUpperCase()} {new Date().getFullYear()}</h3>
                                <div className="table-wrapper">
                                    <table className="full-data-table summary-table">
                                        <thead>
                                            <tr>
                                                <th>CONCEPTO</th>
                                                <th>MONTO</th>
                                                <th>ORIGEN / RECIBIÓ</th>
                                                <th>FECHA</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {/* Manual Expenses First */}
                                            {expensesData.map(exp => (
                                                <tr key={exp.id}>
                                                    <td><strong>{exp.description}</strong></td>
                                                    <td className="amount-highlight">$ {parseFloat(exp.amount).toLocaleString()}</td>
                                                    <td>Carga Manual</td>
                                                    <td>{new Date().toLocaleDateString('es-ES')}</td>
                                                </tr>
                                            ))}

                                            {/* File Expenses */}
                                            {fileExpenses.map((exp, idx) => (
                                                <tr key={`file-${idx}`}>
                                                    <td data-label="Concepto"><strong>{exp.name}</strong></td>
                                                    <td data-label="Monto" className="amount-highlight">{exp.history[exp.history.length - 1]?.amount}</td>
                                                    <td data-label="Recibió">{exp.history[exp.history.length - 1]?.receivedBy || 'Planilla'}</td>
                                                    <td data-label="Fecha">{exp.history[exp.history.length - 1]?.date}</td>
                                                </tr>
                                            ))}

                                            {expensesData.length === 0 && fileExpenses.length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="no-data">Sin gastos detectados</td>
                                                </tr>
                                            )}

                                            <tr className="total-row-highlight">
                                                <td><strong>TOTAL CONSOLIDADO</strong></td>
                                                <td colSpan="3"><strong>$ {totals.totalExpenses.toLocaleString()}</strong></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="settings-container">
                            <h2>Ajustes</h2>
                            <p>Configuración general de la aplicación Beta.</p>

                            <div className="report-card" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                                <h3>Importación de Datos</h3>
                                <p className="report-subtitle">Sincroniza tus datos locales con la planilla central.</p>
                                <div className="list-actions" style={{ marginTop: '1rem', flexDirection: 'column', gap: '0.75rem' }}>
                                    <button className="btn-secondary" style={{ width: '100%' }} onClick={() => fileInputRef.current.click()}>
                                        <Save size={20} /> <span style={{ marginLeft: '0.5rem' }}>Importar CSV Local</span>
                                    </button>
                                    <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setShowLinkModal(true)}>
                                        <Plus size={20} /> <span style={{ marginLeft: '0.5rem' }}>Sincronizar por Link</span>
                                    </button>
                                </div>
                            </div>

                            <div className="danger-zone">
                                <h3>Zona Peligrosa</h3>
                                <p>Las siguientes acciones son permanentes y borrarán todos los datos guardados en este dispositivo.</p>
                                <button className="btn-danger" onClick={handleResetData}>
                                    Reiniciar Toda la Base de Datos
                                </button>
                            </div>
                        </div>
                    )
                    }
                </section>

                {showAddModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Nuevo Alumno</h3>
                            <div className="form-group">
                                <label>Nombre Completo</label>
                                <input type="text" value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} placeholder="Nombre y Apellido" />
                            </div>
                            <div className="form-group-row">
                                <div className="form-group">
                                    <label>Clases por semana</label>
                                    <input type="number" value={newStudent.classesPerWeek} onChange={e => setNewStudent({ ...newStudent, classesPerWeek: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label>Fecha de Ingreso</label>
                                    <input type="date" value={newStudent.entryDate} onChange={e => setNewStudent({ ...newStudent, entryDate: e.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Teléfono (Opcional)</label>
                                <input type="text" value={newStudent.phone} onChange={e => setNewStudent({ ...newStudent, phone: e.target.value })} placeholder="Ej: 1122334455" />
                            </div>

                            <div className="form-divider">Primer Pago (Opcional)</div>

                            <div className="form-group-row">
                                <div className="form-group">
                                    <label>Monto Recibido</label>
                                    <input type="text" value={newStudent.initialAmount} onChange={e => setNewStudent({ ...newStudent, initialAmount: e.target.value })} placeholder="$0.00" />
                                </div>
                                <div className="form-group">
                                    <label>Recibió</label>
                                    <select value={newStudent.initialReceiver} onChange={e => setNewStudent({ ...newStudent, initialReceiver: e.target.value })}>
                                        <option value="Vanina">Vanina</option>
                                        <option value="Nicki">Nicki</option>
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowAddModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={addStudent}>Agregar Alumno</button>
                            </div>
                        </div>
                    </div>
                )}

                {showPaymentModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Registrar Pago</h3>
                            <div className="form-group">
                                <label>Mes Correspondiente</label>
                                <input
                                    type="text"
                                    value={newPayment.month}
                                    onChange={e => setNewPayment({ ...newPayment, month: e.target.value })}
                                    placeholder="Ej: Marzo 2024"
                                />
                            </div>
                            <div className="form-group">
                                <label>Monto</label>
                                <div className="with-prefix">
                                    <span>$</span>
                                    <input
                                        type="number"
                                        value={newPayment.amount}
                                        onChange={e => setNewPayment({ ...newPayment, amount: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Recibió</label>
                                <select
                                    value={newPayment.receivedBy}
                                    onChange={e => setNewPayment({ ...newPayment, receivedBy: e.target.value })}
                                >
                                    <option value="Vanina">Vanina</option>
                                    <option value="Nicki">Nicki</option>
                                </select>
                            </div>
                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowPaymentModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={confirmPayment}>Registrar Pago</button>
                            </div>
                        </div>
                    </div>
                )}
                {
                    showLinkModal && (
                        <div className="modal-overlay">
                            <div className="modal-card">
                                <h3>Importar desde Link</h3>
                                <p className="modal-help">
                                    Pega aquí el link de tu planilla de Google Sheets.
                                    Asegúrate de que esté configurada como <strong>"Cualquier persona con el enlace puede ver"</strong>.
                                </p>
                                <div className="form-group">
                                    <label>Link de Google Sheets</label>
                                    <input
                                        type="text"
                                        value={sheetLink}
                                        onChange={e => setSheetLink(e.target.value)}
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                    />
                                </div>
                                <div className="modal-footer">
                                    <button className="btn-cancel" onClick={() => setShowLinkModal(false)}>Cancelar</button>
                                    <button className="btn-confirm" onClick={handleLinkImport}>Sincronizar Datos</button>
                                </div>
                            </div>
                        </div>
                    )
                }

                <div className="toast-container">
                    {toasts.map(toast => (
                        <div key={toast.id} className={`toast ${toast.type}`}>
                            {toast.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
                            <span>{toast.message}</span>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    )
}

export default App
