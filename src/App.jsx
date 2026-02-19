import { useState, useEffect, useRef } from 'react'
import './App.css'
import { Plus, Search, Filter, History, Trash2, Save, FileText, ChevronRight, User, DollarSign, Calendar, Clock, CreditCard, ChevronLeft, Check, X, MessageCircle, AlertCircle } from 'lucide-react'
import { parsePilatesCSV } from './utils/dataParser'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'

function App() {
    const [students, setStudents] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoaded, setIsLoaded] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [sheetLink, setSheetLink] = useState('');
    const [currentView, setCurrentView] = useState('alumnos'); // alumnos | reportes | ajustes
    const [newStudent, setNewStudent] = useState({
        name: '',
        classesPerWeek: '2',
        entryDate: new Date().toISOString().split('T')[0],
        phone: '',
        initialAmount: '',
        initialReceiver: 'Vanina'
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
            // Definitively filter out ghost students before saving
            const cleanStudents = students.filter(s =>
                s.id !== "0" &&
                s.name.toUpperCase() !== "GRACIELA DOBAL" &&
                s.name.toUpperCase() !== "DANIEL VIEIRA"
            );
            if (cleanStudents.length !== students.length) {
                setStudents(cleanStudents);
            }
            localStorage.setItem('vn_pilates_data', JSON.stringify(cleanStudents));
        }
    }, [students, isLoaded]);

    const handleLinkImport = async () => {
        if (!sheetLink) return;

        let csvUrl = sheetLink;
        // Transform Google Sheets link to export CSV link
        if (csvUrl.includes('/edit')) {
            csvUrl = csvUrl.split('/edit')[0] + '/export?format=csv';
        } else if (!csvUrl.includes('/export')) {
            alert('Por favor, asegúrate de que el link sea de una planilla de Google abierta (clic en Compartir > Cualquier persona con el vínculo puede ver).');
            return;
        }

        try {
            const response = await fetch(csvUrl);
            if (!response.ok) throw new Error('No se pudo acceder al link. Asegúrate de que la planilla sea pública.');

            const text = await response.text();
            const data = await parsePilatesCSV(text);

            if (!data || data.length === 0) throw new Error('No se encontraron datos válidos en el link.');

            setStudents(data);
            setIsLoaded(true);
            setShowLinkModal(false);
            setSheetLink('');
            alert('¡Datos sincronizados desde el link con éxito!');
        } catch (error) {
            console.error('Error link import:', error);
            alert(`Error: ${error.message}`);
        }
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Check if it's a Google Sheets link (not a real CSV)
        if (file.name.toLowerCase().endsWith('.gsheet')) {
            alert('Error: Este archivo es un "Acceso directo de Google Sheets". Para cargarlo, debes abrir el archivo en Google Sheets y descargarlo como CSV (Archivo > Descargar > Valores separados por comas).');
            return;
        }

        // Check if it's actually a CSV (lenient check to help with Drive files)
        const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';

        if (!isCSV && file.type !== "") {
            if (!confirm(`El archivo "${file.name}" no parece un CSV estándar. ¿Deseas intentar cargarlo de todas formas?`)) {
                return;
            }
        }

        try {
            const text = await file.text();
            if (!text || text.trim().length === 0) {
                throw new Error('El archivo está vacío');
            }

            const data = await parsePilatesCSV(text);
            if (!data || data.length === 0) {
                throw new Error('No se encontraron alumnos válidos en el archivo');
            }

            setStudents(data);
            setIsLoaded(true);
            alert('¡Datos cargados con éxito!');
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            alert(`Error al procesar el archivo: ${error.message}. Asegúrate de que sea el formato de exportación esperado.`);
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
    };

    const handleResetData = () => {
        if (confirm('⚠️ ¿ESTÁS SEGURO? Esta acción borrará TODOS los alumnos y pagos permanentemente. No se puede deshacer.')) {
            setStudents([]);
            localStorage.removeItem('vn_pilates_data');
            setIsLoaded(false);
            setCurrentView('alumnos');
            alert('Base de datos borrada correctamente.');
        }
    };

    const deleteStudent = (studentId, event) => {
        event.stopPropagation();
        if (confirm('¿Borrar este alumno definitivamente?')) {
            setStudents(students.filter(s => s.id !== studentId));
        }
    };

    const hasPaidCurrentMonth = (student) => {
        if (!student.history || student.history.length === 0) return false;
        const now = new Date();
        const currentMonth = now.toLocaleDateString('es-ES', { month: 'long' });
        const currentYear = now.getFullYear().toString().slice(-2);
        const searchStr = `${currentMonth} ${currentYear}`.toLowerCase();

        return student.history.some(h =>
            h.month.toLowerCase().includes(currentMonth.toLowerCase()) ||
            h.month.toLowerCase().includes(searchStr)
        );
    };

    const addPayment = (studentId) => {
        const month = prompt('Ingrese el mes (ej: Enero 2024):');
        if (!month) return;
        const amount = prompt('Monto:');
        const receivedBy = prompt('Recibió (Vanina/Nicki):') || 'Vanina';

        const updatedStudents = students.map(s => {
            if (s.id === studentId) {
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
                if (selectedStudent && selectedStudent.id === studentId) {
                    setSelectedStudent(updatedStudent);
                }
                return updatedStudent;
            }
            return s;
        });

        setStudents(updatedStudents);
    };

    const saveStudentChanges = () => {
        if (!selectedStudent) return;
        setStudents(students.map(s => s.id === selectedStudent.id ? selectedStudent : s));
        alert('Cambios guardados correctamente');
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
                const amount = parseFloat(h.amount.replace('$', '').replace(',', '')) || 0;
                totalMoney += amount;
                totalPayments++;
                if (h.receivedBy?.toLowerCase().includes('vani')) vanniMoney += amount;
                if (h.receivedBy?.toLowerCase().includes('nic')) nickiMoney += amount;
            });
        });

        const activeStudents = students.filter(s => s.history.length > 0).length;
        const averagePerStudent = activeStudents ? totalMoney / activeStudents : 0;

        return { totalMoney, totalClasses, vanniMoney, nickiMoney, totalPayments, activeStudents, averagePerStudent };
    };

    const totals = calculateTotals();

    const exportToCSV = () => {
        // Build export in the original 19-column spreadsheet format
        const headers = ["ID", "NOMBRE", "INGRESO", "CLASES/SEM"];

        // Get all unique months to create columns
        const months = [];
        students.forEach(s => {
            s.history.forEach(h => {
                if (!months.includes(h.month)) months.push(h.month);
            });
        });

        // Take last 5 months for the columns (like the original)
        const activeMonths = months.slice(-5);
        activeMonths.forEach(m => {
            headers.push(m, "Recibió", "Fecha");
        });

        const rows = students.map(s => {
            const row = [s.id, s.name, s.entryDate, s.classesPerWeek];
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

        const csvContent = [headers, ...rows].map(e => e.map(val => `"${val || ''}"`).join(",")).join("\n");
        const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Gestion-VN-Pilates-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

        // Students Table
        doc.setFontSize(14);
        doc.text("Listado de Alumnos", 14, doc.lastAutoTable.finalY + 15);

        const studentHeaders = [["Nombre", "Clases/Sem", "Ingreso", "Último Pago"]];
        const studentData = students.map(s => [
            s.name,
            s.classesPerWeek,
            s.entryDate,
            s.history.length > 0 ? `${s.history[0].month} (${s.history[0].amount})` : '-'
        ]);

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 20,
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
                    </div>
                    <nav className="nav-menu">
                        <button
                            className={`nav-item ${currentView === 'alumnos' ? 'active' : ''}`}
                            onClick={() => { setCurrentView('alumnos'); setSelectedStudent(null); }}
                        >
                            <User size={20} /> <span>Alumnos</span>
                        </button>
                        <button
                            className={`nav-item ${currentView === 'reportes' ? 'active' : ''}`}
                            onClick={() => { setCurrentView('reportes'); setSelectedStudent(null); }}
                        >
                            <FileText size={20} /> <span>Reportes</span>
                        </button>
                    </nav>
                </aside>

                <main className="main-content">
                    <header className="main-header">
                        <button className="btn-back" onClick={() => { setSelectedStudent(null); setSearchTerm(''); }}>
                            <ChevronLeft size={20} /> Volver al listado
                        </button>
                        <div className="header-actions">
                            <button className="btn-secondary" onClick={() => exportStudentPDF(selectedStudent)} title="Exportar ficha PDF"><FileText size={18} /></button>
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
                                    {isLoaded && <button className="btn-secondary" onClick={exportToCSV}>Exportar CSV</button>}
                                    {!isLoaded && (
                                        <button className="btn-upload" onClick={() => fileInputRef.current.click()}>
                                            Importar CSV de Gestión
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
                                                <h4>{student.name}</h4>
                                                <p>{student.classesPerWeek} veces por semana</p>
                                            </div>
                                            <div className="student-actions">
                                                {hasPaidCurrentMonth(student) ? (
                                                    <div className="action-icon check" title="Pago al día">
                                                        <Check size={18} />
                                                    </div>
                                                ) : (
                                                    <div className="action-icon pending" title="Pago pendiente">
                                                        <Clock size={18} />
                                                    </div>
                                                )}
                                                {student.phone && (
                                                    <a
                                                        href={`https://wa.me/${student.phone.replace(/\D/g, '')}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="action-icon whatsapp"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="WhatsApp"
                                                    >
                                                        <MessageCircle size={18} />
                                                    </a>
                                                )}
                                                <button
                                                    className="action-icon delete"
                                                    onClick={(e) => deleteStudent(student.id, e)}
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                            <ChevronRight size={18} className="arrow" />
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
                                        <button className="btn-secondary" onClick={exportToCSV}>
                                            <Save size={16} /> Excel
                                        </button>
                                        <button className="btn-secondary" onClick={exportToPDF}>
                                            <FileText size={16} /> PDF
                                        </button>
                                    </div>
                                </div>

                                <div className="report-stats">
                                    <div className="stat-main">
                                        <label>Recaudación Total</label>
                                        <p className="amount-total">${totals.totalMoney.toLocaleString()}</p>
                                    </div>
                                    <div className="stat-grid">
                                        <div className="stat">
                                            <label>Alumnos Totales</label>
                                            <p>{students.length}</p>
                                        </div>
                                        <div className="stat">
                                            <label>Con Pagos</label>
                                            <p>{totals.activeStudents}</p>
                                        </div>
                                        <div className="stat">
                                            <label>Clases Semanales</label>
                                            <p>{totals.totalClasses}</p>
                                        </div>
                                        <div className="stat">
                                            <label>Promedio c/u</label>
                                            <p>${Math.round(totals.averagePerStudent).toLocaleString()}</p>
                                        </div>
                                    </div>

                                    <div className="stat-receivers">
                                        <div className="receiver-stat vanni">
                                            <label>Vanina</label>
                                            <p>${totals.vanniMoney.toLocaleString()}</p>
                                        </div>
                                        <div className="receiver-stat nicki">
                                            <label>Nicki</label>
                                            <p>${totals.nickiMoney.toLocaleString()}</p>
                                        </div>
                                    </div>
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
                                                    <td>{s.name}</td>
                                                    <td>{s.entryDate}</td>
                                                    <td>{s.classesPerWeek}</td>
                                                    <td>{s.history[0]?.month || '-'}</td>
                                                    <td>{s.history[0]?.amount || '-'}</td>
                                                    <td>{s.history[0]?.receivedBy || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="settings-container">
                            <h2>Ajustes</h2>
                            <p>Configuración general de la aplicación Beta.</p>

                            <div className="danger-zone">
                                <h3>Zona Peligrosa</h3>
                                <p>Las siguientes acciones son permanentes y borrarán todos los datos guardados en este dispositivo.</p>
                                <button className="btn-danger" onClick={handleResetData}>
                                    Reiniciar Toda la Base de Datos
                                </button>
                            </div>
                        </div>
                    )}
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
                {showLinkModal && (
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
                )}
            </main>
        </div>
    )
}

export default App
