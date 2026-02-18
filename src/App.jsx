import { useState, useEffect, useRef } from 'react'
import './App.css'
import { Plus, Search, Filter, History, Trash2, Save, FileText, ChevronRight, User, DollarSign, Calendar, Clock, CreditCard, ChevronLeft } from 'lucide-react'
import { parsePilatesCSV } from './utils/dataParser'

function App() {
    const [students, setStudents] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoaded, setIsLoaded] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [currentView, setCurrentView] = useState('alumnos'); // alumnos | historiales | reportes
    const [newStudent, setNewStudent] = useState({ name: '', classesPerWeek: '2', entryDate: new Date().toISOString().split('T')[0] });
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
            localStorage.setItem('vn_pilates_data', JSON.stringify(students));
        }
    }, [students, isLoaded]);

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (file) {
            const text = await file.text();
            const data = await parsePilatesCSV(text);
            setStudents(data);
            setIsLoaded(true);
        }
    };

    const addStudent = () => {
        if (!newStudent.name) return;
        const student = {
            id: `manual-${Date.now()}`,
            name: newStudent.name,
            classesPerWeek: newStudent.classesPerWeek,
            entryDate: newStudent.entryDate,
            history: []
        };
        setStudents([student, ...students]);
        setNewStudent({ name: '', classesPerWeek: '2', entryDate: new Date().toISOString().split('T')[0] });
        setShowAddModal(false);
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

    const exportToCSV = () => {
        // Basic export: rebuild spreadsheet structure
        const headers = ["ID", "NOMBRE", "INGRESO", "CLASES/SEM", "HISTORIAL (MES:MONTO:RECIBE:FECHA)"];
        const rows = students.map(s => [
            s.id, s.name, s.entryDate, s.classesPerWeek,
            s.history.map(h => `${h.month}|${h.amount}|${h.receivedBy}|${h.date}`).join(';')
        ]);

        const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Gestion-VN-Pilates-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const filteredStudents = students.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (selectedStudent) {
        return (
            <div className="app-container">
                <aside className="sidebar">
                    <div className="logo-section">
                        <h1>VN Pilates</h1>
                    </div>
                    <nav>
                        <button
                            className={`nav-item ${currentView === 'alumnos' ? 'active' : ''}`}
                            onClick={() => { setCurrentView('alumnos'); setSelectedStudent(null); }}
                        >
                            <User size={20} /> Alumnos
                        </button>
                        <button
                            className={`nav-item ${currentView === 'reportes' ? 'active' : ''}`}
                            onClick={() => { setCurrentView('reportes'); setSelectedStudent(null); }}
                        >
                            <FileText size={20} /> Reportes
                        </button>
                    </nav>
                </aside>

                <main className="main-content">
                    <header className="main-header">
                        <button className="btn-back" onClick={() => setSelectedStudent(null)}>
                            <ChevronLeft size={20} /> Volver al listado
                        </button>
                        <div className="header-actions">
                            <button className="btn-save" onClick={saveStudentChanges}><Save size={18} /> Guardar Cambios</button>
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
                </div>
                <nav>
                    <button
                        className={`nav-item ${currentView === 'alumnos' ? 'active' : ''}`}
                        onClick={() => setCurrentView('alumnos')}
                    >
                        <User size={20} /> Alumnos
                    </button>
                    <button
                        className={`nav-item ${currentView === 'reportes' ? 'active' : ''}`}
                        onClick={() => setCurrentView('reportes')}
                    >
                        <FileText size={20} /> Reportes
                    </button>
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
                                    accept=".csv"
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
                                            <ChevronRight size={18} className="arrow" />
                                        </div>
                                    ))
                                ) : (
                                    <div className="empty-state">
                                        <div className="icon-box">
                                            <FileText size={40} />
                                        </div>
                                        <div className="text-box">
                                            <p>Cargue los datos iniciales para comenzar</p>
                                            <span>Seleccione el archivo "Planilla vieja VN.csv"</span>
                                        </div>
                                        <button className="btn-primary-large" onClick={() => fileInputRef.current.click()}>
                                            Seleccionar Archivo
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="reports-container">
                            <div className="report-card">
                                <h3>Resumen Financiero</h3>
                                <div className="report-stats">
                                    <div className="stat">
                                        <label>Total Alumnos</label>
                                        <p>{students.length}</p>
                                    </div>
                                    <div className="stat">
                                        <label>Pagos Registrados</label>
                                        <p>{students.reduce((acc, s) => acc + s.history.length, 0)}</p>
                                    </div>
                                </div>
                                <p className="note">Próximamente: Desglose por profesor y neto mensual.</p>
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
                            <div className="form-group">
                                <label>Clases por semana</label>
                                <input type="number" value={newStudent.classesPerWeek} onChange={e => setNewStudent({ ...newStudent, classesPerWeek: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Fecha de Ingreso</label>
                                <input type="date" value={newStudent.entryDate} onChange={e => setNewStudent({ ...newStudent, entryDate: e.target.value })} />
                            </div>
                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowAddModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={addStudent}>Agregar Alumno</button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}

export default App
