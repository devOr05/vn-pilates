import { useState, useEffect, useRef } from 'react'
import './App.css'
import {
    Plus,
    User,
    FileText,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Trash2,
    Save,
    Search,
    Filter,
    MessageCircle,
    Check,
    AlertCircle,
    Settings,
    X,
    Pencil,
    DollarSign,
    Clock
} from 'lucide-react';
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
        initialReceiver: 'Vanina'
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
            localStorage.setItem('vn_pilates_data', JSON.stringify(cleanStudents));
        }
    }, [students, isLoaded]);

    useEffect(() => {
        localStorage.setItem('vn_pilates_file_expenses', JSON.stringify(fileExpenses));
    }, [fileExpenses]);

    useEffect(() => {
        localStorage.setItem('vn_pilates_salary', JSON.stringify(salaryData));
    }, [salaryData]);

    useEffect(() => {
        localStorage.setItem('vn_pilates_expenses', JSON.stringify(expensesData));
    }, [expensesData]);

    const handleLinkImport = async () => {
        if (!sheetLink) return;
        let csvUrl = sheetLink;
        if (sheetLink.includes('/pubhtml')) {
            csvUrl = sheetLink.replace('/pubhtml', '/pub?output=csv');
        } else {
            const idMatch = sheetLink.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (idMatch && idMatch[1]) {
                csvUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
            } else if (!csvUrl.includes('/export') && !csvUrl.includes('/pub')) {
                showToast('Por favor, asegúrate de que el link sea de una planilla de Google Sheets válida.', 'error');
                return;
            }
        }

        try {
            let response;
            try {
                response = await fetch(csvUrl);
                if (!response.ok) throw new Error('Fetch failed');
            } catch (e) {
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
            showToast(`Error de sincronización: ${error.message}`, 'error');
        }
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const { students: parsedStudents, automaticExpenses } = await parsePilatesCSV(text);
            setStudents(parsedStudents);
            setFileExpenses(automaticExpenses);
            setIsLoaded(true);
            showToast('¡Datos cargados con éxito!');
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            showToast(`Error al procesar el archivo: ${error.message}`, 'error');
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
        if (window.confirm('⚠️ ¿ESTÁS SEGURO?')) {
            setStudents([]);
            localStorage.removeItem('vn_pilates_data');
            setIsLoaded(false);
            setCurrentView('alumnos');
            showToast('Base de datos borrada.', 'error');
        }
    };

    const deleteStudent = (studentId, event) => {
        event.stopPropagation();
        if (window.confirm('¿Estás seguro?')) {
            setStudents(students.filter(s => s.id !== studentId));
            showToast("Alumno eliminado", "error");
        }
    };

    const hasPaidCurrentMonth = (student) => {
        if (!student.history || student.history.length === 0) return false;
        const now = new Date();
        const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const currentMonthName = months[now.getMonth()];
        return student.history.some(h => h.month.toLowerCase().includes(currentMonthName));
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
                if (selectedStudent && selectedStudent.id === paymentStudentId) {
                    setSelectedStudent(updatedStudent);
                }
                return updatedStudent;
            }
            return s;
        });

        setStudents(updatedStudents);
        setShowPaymentModal(false);
        showToast("Pago agregado correctamente");
    };

    const saveStudentChanges = () => {
        if (!selectedStudent) return;
        setStudents(students.map(s => s.id === selectedStudent.id ? selectedStudent : s));
        showToast("Cambios guardados");
    };

    const updateStudentField = (field, value) => {
        setSelectedStudent({ ...selectedStudent, [field]: value });
    };

    const calculateTotals = () => {
        let totalMoney = 0;
        let totalClasses = 0;
        let vanniMoney = 0;
        let nickiMoney = 0;
        students.forEach(s => {
            totalClasses += parseInt(s.classesPerWeek) || 0;
            s.history.forEach(h => {
                const amount = cleanMoneyString(h.amount);
                totalMoney += amount;
                if (h.receivedBy?.toLowerCase().includes('vani')) vanniMoney += amount;
                if (h.receivedBy?.toLowerCase().includes('nic')) nickiMoney += amount;
            });
        });
        const activeStudents = students.filter(s => s.history.length > 0).length;
        const manualExpenses = expensesData.reduce((acc, exp) => acc + (parseFloat(exp.amount) || 0), 0);
        const autoExpensesValue = fileExpenses.reduce((acc, exp) => {
            const latestPayment = exp.history[exp.history.length - 1];
            return acc + (latestPayment ? cleanMoneyString(latestPayment.amount) : 0);
        }, 0);
        const totalExpenses = manualExpenses + autoExpensesValue;
        return { totalMoney, totalClasses, vanniMoney, nickiMoney, activeStudents, totalExpenses };
    };

    const totals = calculateTotals();

    const exportToExcel = (type = 'alumnos') => {
        let headers = [];
        let rows = [];
        let filename = "";

        if (type === 'alumnos') {
            headers = ["ID", "NOMBRE", "INGRESO", "CLASES/SEM", "TELEFONO"];
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
            filename = `Alumnos-VN-Pilates.xlsx`;
        } else {
            headers = ["MES", "RECIBIDO POR", "CONCEPTO", "ALUMNO", "MONTO"];
            students.forEach(s => {
                s.history.forEach(h => {
                    rows.push([h.month, h.receivedBy, "Pago Cuota", s.name, h.amount]);
                });
            });
            rows.push([], ["RESUMEN DE HONORARIOS"], ["PROFESOR", "HORAS", "VALOR HORA", "SUELDO BRUTO", "ADELANTOS", "RESTO A PAGAR"]);
            ['vanni', 'nicki'].forEach(p => {
                const d = salaryData[p];
                const sueldo = d.hours * d.hourlyValue;
                rows.push([p.toUpperCase(), d.hours, `$ ${d.hourlyValue.toLocaleString()}`, `$ ${sueldo.toLocaleString()}`, `$ ${d.advances.toLocaleString()}`, `$ ${(sueldo - d.advances).toLocaleString()}`]);
            });
            rows.push([], ["RESUMEN DE GASTOS"], ["DESCRIPCIÓN", "MONTO", "ORIGEN", "FECHA"]);
            expensesData.forEach(exp => rows.push([exp.description, `$ ${parseFloat(exp.amount).toLocaleString()}`, "Manual", new Date().toLocaleDateString()]));
            fileExpenses.forEach(exp => {
                const l = exp.history[exp.history.length - 1];
                if (l) rows.push([exp.name, l.amount, l.receivedBy || 'Planilla', l.date]);
            });
            rows.push(["TOTAL GASTOS", `$ ${totals.totalExpenses.toLocaleString()}`]);
            filename = `Reporte-Finanzas-Pilates.xlsx`;
        }
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
        XLSX.writeFile(workbook, filename);
    };

    const exportToPDF = () => {
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text("Resumen de Gestión VN Pilates", 14, 20);
        doc.autoTable({
            startY: 40,
            head: [["Concepto", "Valor"]],
            body: [
                ["Recaudación Total", `$${totals.totalMoney.toLocaleString()}`],
                ["Total Alumnos", students.length.toString()],
                ["Recibió Vanni", `$${totals.vanniMoney.toLocaleString()}`],
                ["Recibió Nicki", `$${totals.nickiMoney.toLocaleString()}`],
                ["Gastos Totales", `$${totals.totalExpenses.toLocaleString()}`],
                ["Ganancia Neta", `$${(totals.totalMoney - totals.totalExpenses).toLocaleString()}`]
            ],
            theme: 'striped',
            headStyles: { fillStyle: '#6366f1' }
        });
        doc.save(`VN-Pilates-Reporte.pdf`);
    };

    const exportStudentPDF = (student) => {
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text(`Ficha de Alumno: ${student.name}`, 14, 20);
        doc.autoTable({
            startY: 40,
            head: [["Mes", "Monto", "Recibió", "Fecha de Pago"]],
            body: student.history.map(h => [h.month, h.amount, h.receivedBy, h.date]),
            theme: 'striped',
            headStyles: { fillStyle: '#6366f1' }
        });
        doc.save(`Ficha-${student.name}.pdf`);
    };

    const filteredStudents = students.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        s.id !== "0" &&
        s.name.toUpperCase() !== "GRACIELA DOBAL" &&
        s.name.toUpperCase() !== "DANIEL VIEIRA"
    );

    const sidebar = (
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
                    <button
                        className={`nav-item ${currentView === 'ajustes' ? 'active' : ''}`}
                        onClick={() => { setCurrentView('ajustes'); setSelectedStudent(null); }}
                    >
                        <Settings size={22} /> <span>Ajustes</span>
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
            </nav>
        </aside>
    );

    return (
        <div className="app-container">
            {sidebar}

            <main className="main-content">
                {selectedStudent ? (
                    <>
                        <header className="main-header">
                            <button className="btn-back" onClick={() => { setSelectedStudent(null); setSearchTerm(''); }}>
                                <ChevronLeft size={20} /> Volver al listado
                            </button>
                            <div className="header-actions">
                                <button className="btn-secondary" onClick={() => exportStudentPDF(selectedStudent)} title="Exportar Ficha PDF">
                                    <FileText size={18} />
                                </button>
                                <button className="btn-secondary" onClick={() => showToast('Módulo de Ficha Médica en desarrollo', 'error')}>
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
                    </>
                ) : (
                    <>
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
                                <h2>{currentView === 'reportes' ? 'Reportes Financieros' : 'Configuración'}</h2>
                            )}
                            <div className="header-actions">
                                {currentView === 'alumnos' && (
                                    <button className="btn-save" onClick={() => setShowAddModal(true)}>
                                        <Plus size={18} /> Nuevo Alumno
                                    </button>
                                )}
                            </div>
                        </header>

                        <div className="dashboard">
                            {currentView === 'alumnos' ? (
                                <div className="student-grid">
                                    {isLoaded ? (
                                        filteredStudents.length > 0 ? (
                                            filteredStudents.map(student => (
                                                <div
                                                    key={student.id}
                                                    className="student-card"
                                                    onClick={() => setSelectedStudent({ ...student })}
                                                >
                                                    <div className="student-card-main">
                                                        <div className="student-info">
                                                            <div className="avatar">
                                                                <User size={24} />
                                                            </div>
                                                            <div className="details">
                                                                <h4>{student.name}</h4>
                                                                <p>{student.classesPerWeek} clases/semana</p>
                                                            </div>
                                                        </div>
                                                        <ChevronRight size={20} className="chevron" />
                                                    </div>
                                                    <div className="student-card-footer">
                                                        <div className="last-payment">
                                                            <span>Ultimo Pago:</span>
                                                            <p>{student.history[0]?.month || 'Sin datos'}</p>
                                                        </div>
                                                        <a
                                                            href={`https://wa.me/${student.phone?.replace(/\D/g, '')}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="mini-icon whatsapp"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <MessageCircle size={14} />
                                                        </a>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="no-results">
                                                <Search size={40} />
                                                <p>No se encontraron alumnos.</p>
                                            </div>
                                        )
                                    ) : (
                                        <div className="empty-state">
                                            <div className="icon-box highlight">
                                                <FileText size={48} />
                                            </div>
                                            <div className="text-box">
                                                <h3>Bienvenido a VN Pilates</h3>
                                                <p>Aún no hay datos cargados.</p>
                                            </div>
                                            <button className="btn-primary-large" onClick={() => fileInputRef.current.click()}>
                                                Importar Planilla
                                            </button>
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                onChange={handleFileUpload}
                                                style={{ display: 'none' }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : currentView === 'reportes' ? (
                                <div className="reports-container">
                                    <div className="report-header">
                                        <div className="header-info">
                                            <h3>Resumen de Ingresos</h3>
                                        </div>
                                        <div className="report-header-buttons">
                                            <button className="btn-secondary" onClick={() => exportToExcel('reporte')}>
                                                <Save size={18} /> Excel
                                            </button>
                                            <button className="btn-secondary" onClick={exportToPDF}>
                                                <FileText size={18} /> PDF
                                            </button>
                                        </div>
                                    </div>

                                    <div className="report-stats">
                                        <div className="report-stat-card primary">
                                            <div className="stat-label">Ingreso Bruto</div>
                                            <div className="stat-value">$ {totals.totalMoney.toLocaleString()}</div>
                                        </div>
                                        <div className="report-stat-card danger">
                                            <div className="stat-label">Gastos</div>
                                            <div className="stat-value">$ {totals.totalExpenses.toLocaleString()}</div>
                                        </div>
                                        <div className="report-stat-card success">
                                            <div className="stat-label">Ganancia Neta</div>
                                            <div className="stat-value">$ {(totals.totalMoney - totals.totalExpenses).toLocaleString()}</div>
                                        </div>
                                    </div>

                                    <div className="report-card">
                                        <h3>Honorarios</h3>
                                        <div className="salary-grid">
                                            {['vanni', 'nicki'].map(person => {
                                                const data = salaryData[person];
                                                const sueldo = data.hours * data.hourlyValue;
                                                return (
                                                    <div key={person} className="salary-card">
                                                        <h4>{person.toUpperCase()}</h4>
                                                        <div className="salary-inputs">
                                                            <div className="input-group">
                                                                <label>Horas</label>
                                                                <input
                                                                    type="number"
                                                                    value={data.hours}
                                                                    onChange={e => setSalaryData({ ...salaryData, [person]: { ...data, hours: parseFloat(e.target.value) || 0 } })}
                                                                />
                                                            </div>
                                                            <div className="input-group">
                                                                <label>Valor Hora</label>
                                                                <input
                                                                    type="number"
                                                                    value={data.hourlyValue}
                                                                    onChange={e => setSalaryData({ ...salaryData, [person]: { ...data, hourlyValue: parseFloat(e.target.value) || 0 } })}
                                                                />
                                                            </div>
                                                            <div className="input-group">
                                                                <label>Adelantos</label>
                                                                <input
                                                                    type="number"
                                                                    value={data.advances}
                                                                    onChange={e => setSalaryData({ ...salaryData, [person]: { ...data, advances: parseFloat(e.target.value) || 0 } })}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="salary-results">
                                                            <p>Sueldo: ${sueldo.toLocaleString()}</p>
                                                            <p>Saldo: ${(sueldo - data.advances).toLocaleString()}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="report-card">
                                        <h3>Gastos Operativos</h3>
                                        <div className="expense-form">
                                            <input
                                                type="text"
                                                placeholder="Descripción"
                                                value={newExpense.description}
                                                onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                                            />
                                            <input
                                                type="number"
                                                placeholder="Monto"
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
                                </div>
                            ) : (
                                <div className="settings-container">
                                    <h2>Ajustes</h2>
                                    <button className="btn-danger" onClick={handleResetData}>
                                        Reiniciar Base de Datos
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {showAddModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Nuevo Alumno</h3>
                            <div className="form-group">
                                <label>Nombre</label>
                                <input type="text" value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} />
                            </div>
                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowAddModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={addStudent}>Agregar</button>
                            </div>
                        </div>
                    </div>
                )}

                {showPaymentModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Registrar Pago</h3>
                            <div className="form-group">
                                <label>Monto</label>
                                <input
                                    type="number"
                                    value={newPayment.amount}
                                    onChange={e => setNewPayment({ ...newPayment, amount: e.target.value })}
                                />
                            </div>
                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowPaymentModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={confirmPayment}>Registrar</button>
                            </div>
                        </div>
                    </div>
                )}

                {showLinkModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Importar por Link</h3>
                            <input
                                type="text"
                                value={sheetLink}
                                onChange={e => setSheetLink(e.target.value)}
                                placeholder="Link de Google Sheets..."
                            />
                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowLinkModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={handleLinkImport}>Sincronizar</button>
                            </div>
                        </div>
                    </div>
                )}

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
    );
}

export default App
