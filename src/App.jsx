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
    Clock,
    Bell,
    Camera,
    Image as ImageIcon,
    FileCheck,
    LogOut,
    Mail,
    Lock
} from 'lucide-react';
import { supabase } from './supabaseClient';
import { parsePilatesCSV, cleanMoneyString } from './utils/dataParser'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import * as XLSX from 'xlsx'
import Tesseract from 'tesseract.js';

function App() {
    const [students, setStudents] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoaded, setIsLoaded] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentStudentId, setPaymentStudentId] = useState(null);
    const [newPayment, setNewPayment] = useState({ month: '', amount: '', receivedBy: '' });
    const [sheetLink, setSheetLink] = useState('');
    const [currentView, setCurrentView] = useState('alumnos'); // alumnos | reportes | ajustes
    const [toasts, setToasts] = useState([]);
    const [showPhoneAddModal, setShowPhoneAddModal] = useState(false);
    const [phoneToAdd, setPhoneToAdd] = useState('');
    const [generatedLink, setGeneratedLink] = useState('');

    const [notifications, setNotifications] = useState([]);
    const [newNotification, setNewNotification] = useState({
        title: '',
        message: '',
        type: 'General',
        target: 'Todos'
    });

    const [registrationToken, setRegistrationToken] = useState(null);
    const [isStudentMode, setIsStudentMode] = useState(false);
    const [studentStep, setStudentStep] = useState(1); // 1: Datos, 2: Disciplina/Horario, 3: Dashboard
    const [studentData, setStudentData] = useState({
        name: '',
        dni: '',
        birthDate: '',
        address: '',
        physicalAptitudeUrl: null,
        dniUrl: null,
        disciplina: '',
        horario: ''
    });
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const [statusFilter, setStatusFilter] = useState('todos'); // todos | activo | pendiente | inactivo

    const [session, setSession] = useState(null);
    const [authMode, setAuthMode] = useState('login'); // login | signup
    const [authEmail, setAuthEmail] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [authLoading, setAuthLoading] = useState(false);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [ocrLoading, setOcrLoading] = useState(false);

    const [userWorkspace, setUserWorkspace] = useState(null);
    const [clientType, setClientType] = useState('alumnos'); // alumnos | pacientes
    const [showResend, setShowResend] = useState(false);
    const [currentStudent, setCurrentStudent] = useState(null);

    // Helpers for dynamic terminology
    const getLabel = (singular = false) => {
        if (clientType === 'alumnos') return singular ? 'Alumno' : 'Alumnos';
        return singular ? 'Paciente' : 'Pacientes';
    };

    useEffect(() => {
        console.log("Auth Effect: Initializing...");
        if (!supabase) {
            console.warn("Auth Effect: Supabase client is null. Missing config?");
            setIsInitialLoad(false);
            return;
        }

        // Check current session
        supabase.auth.getSession().then(({ data: { session }, error }) => {
            console.log("Auth Effect: getSession result:", { session: !!session, error });
            setSession(session);
            if (session) {
                fetchAppData(session.user);
            } else {
                setIsInitialLoad(false);
            }
        });

        // Listen for changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            console.log("Auth Effect: onAuthStateChange event:", event, "session:", !!session);
            setSession(session);
            if (session) {
                fetchAppData(session.user);
            } else {
                setStudents([]);
                setNotifications([]);
                setUserWorkspace(null);
                setIsLoaded(false);
                setIsInitialLoad(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const fetchAppData = async (user) => {
        console.log("fetchAppData: Starting for user:", user.email);
        try {
            // 1. Get or Create Workspace
            let workspaceMembers, memberError;
            const result = await supabase
                .from('workspace_members')
                .select('workspace_id, workspaces(*)')
                .eq('user_id', user.id);
            workspaceMembers = result.data;
            memberError = result.error;

            if (memberError) {
                console.error("fetchAppData: memberError:", memberError);
                throw memberError;
            }

            // Set default "recibido" for modals
            const adminName = user.user_metadata?.full_name || user.email.split('@')[0];
            setNewPayment(prev => ({ ...prev, receivedBy: adminName }));
            setNewStudent(prev => ({ ...prev, initialReceiver: adminName }));
            setEditAdminName(adminName);

            if (workspaceMembers && workspaceMembers.length > 0) {
                setClientType(workspaceMembers[0].workspaces.client_type || 'alumnos');
            }

            console.log("fetchAppData: workspaceMembers found:", workspaceMembers?.length || 0);
            let workspaceId;

            if (!workspaceMembers || workspaceMembers.length === 0) {
                console.log("fetchAppData: No workspace found, checking invites...");
                // Check if user has an invite
                const { data: invites, error: invError } = await supabase
                    .from('workspace_invites')
                    .select('*')
                    .eq('email', user.email);

                if (invError) console.error("fetchAppData: invite check error:", invError);

                if (invites && invites.length > 0) {
                    console.log("fetchAppData: Found invite, joining workspace:", invites[0].workspace_id);
                    const invite = invites[0];
                    const { error: joinError } = await supabase.from('workspace_members').insert([
                        { workspace_id: invite.workspace_id, user_id: user.id, role: invite.role }
                    ]);

                    if (joinError) throw joinError;

                    // Delete the invite as it's been used
                    await supabase.from('workspace_invites').delete().eq('id', invite.id);

                    // Re-run to load correctly
                    return fetchAppData(user);
                }

                console.log("fetchAppData: Creating default workspace...");
                // Create default workspace for new user
                const { data: newWS, error: wsError } = await supabase
                    .from('workspaces')
                    .insert([{ name: `${user.email.split('@')[0]}'s Workspace`, owner_id: user.id }])
                    .select()
                    .single();

                if (wsError) throw wsError;
                console.log("fetchAppData: Workspace created:", newWS.id);

                await supabase.from('workspace_members').insert([
                    { workspace_id: newWS.id, user_id: user.id, role: 'owner' }
                ]);

                // 1b. Ensure Profile exists
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                if (!profile) {
                    await supabase.from('profiles').insert([
                        { id: user.id, full_name: user.email.split('@')[0] }
                    ]);
                }

                workspaceId = newWS.id;
                setUserWorkspace(newWS);
                setEditWorkspaceName(newWS.name);
            } else {
                workspaceId = workspaceMembers[0].workspace_id;
                setUserWorkspace(workspaceMembers[0].workspaces);
                setEditWorkspaceName(workspaceMembers[0].workspaces.name);
            }

            // 2. Fetch Students
            const { data: studentsData, error: stError } = await supabase
                .from('students')
                .select('*, payments(*)')
                .eq('workspace_id', workspaceId);

            if (stError) throw stError;

            // Map Supabase data to existing App format
            const formattedStudents = studentsData.map(s => ({
                id: s.id,
                name: s.name,
                entryDate: s.entry_date,
                classesPerWeek: s.classes_per_week,
                phone: s.phone,
                status: s.status,
                registrationToken: s.registration_token,
                dni: s.dni,
                birthDate: s.birth_date,
                address: s.address,
                physicalAptitudeUrl: s.physical_aptitude_url,
                history: (s.payments || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(p => ({
                    month: p.month,
                    amount: p.amount.toString(),
                    receivedBy: p.received_by,
                    date: new Date(p.created_at).toLocaleDateString()
                }))
            }));

            setStudents(formattedStudents);
            setIsLoaded(true);

            // 4. Fetch Personnel List from Configs
            const { data: configData } = await supabase
                .from('workspace_configs')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('config_key', 'personnel_list')
                .maybeSingle();

            if (configData && configData.config_value) {
                setPersonnelList(Array.isArray(configData.config_value) ? configData.config_value : []);
            } else {
                setPersonnelList([]);
            }

            // 5. Fetch Salary Data
            const { data: salData, error: salError } = await supabase
                .from('workspace_configs')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('config_key', 'salary_data')
                .maybeSingle();

            if (salError) throw salError;

            if (salData && salData.config_value) {
                let val = salData.config_value;
                // Migration: if old data was an object {vanni: ..., nicki: ...}, convert it
                if (!Array.isArray(val) && typeof val === 'object' && val !== null) {
                    console.log("fetchAppData: Migrating salaryData from object to array...");
                    const migrated = [];
                    if (val.vanni) migrated.push({ personId: '1', ...val.vanni });
                    if (val.nicki) migrated.push({ personId: '2', ...val.nicki });
                    setSalaryData(migrated);
                } else {
                    setSalaryData(Array.isArray(val) ? val : []);
                }
            } else {
                setSalaryData([]);
            }

            // 6. Fetch Notifications
            const { data: notificationsData, error: notifError } = await supabase
                .from('notifications')
                .select('*')
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: false });

            if (notifError) throw notifError;
            setNotifications(notificationsData);

            setIsLoaded(true);

            // 4. Fetch Expenses
            const { data: expenses } = await supabase
                .from('expenses')
                .select('*')
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: false });

            if (expenses) {
                setExpensesData(expenses.filter(e => e.category === 'Operativo').map(e => ({
                    id: e.id,
                    description: e.description,
                    amount: e.amount.toString()
                })));
                setFileExpenses(expenses.filter(e => e.category === 'Planilla').map(e => ({
                    id: e.id,
                    description: e.description,
                    history: [{ amount: `$${e.amount}`, date: new Date(e.created_at).toLocaleDateString() }]
                })));
            }

            setIsInitialLoad(false);
            console.log("fetchAppData: Success!");
        } catch (error) {
            console.error("fetchAppData: Critical Error:", error);
            showToast("Error al cargar datos de la nube", "error");
            setIsInitialLoad(false);
            setIsLoaded(true); // Allow UI to show even if data fetch failed partially
        }
    };

    const handleAuth = async (e) => {
        e.preventDefault();
        console.log("handleAuth: Starting...", { mode: authMode, email: authEmail });
        setAuthLoading(true);
        try {
            if (authMode === 'login') {
                const { error, data } = await supabase.auth.signInWithPassword({
                    email: authEmail,
                    password: authPassword
                });
                if (error) {
                    console.error("handleAuth: Login Error:", error);
                    throw error;
                }
                console.log("handleAuth: Login Success!", data.user?.id);
            } else {
                const { error, data } = await supabase.auth.signUp({
                    email: authEmail,
                    password: authPassword,
                    options: {
                        emailRedirectTo: window.location.origin
                    }
                });
                if (error) {
                    console.error("handleAuth: Signup Error:", error);
                    throw error;
                }
                console.log("handleAuth: Signup Success!", data.user?.id);
                showToast("Registro exitoso. ¡Revisa tu email!", "success");
            }
        } catch (error) {
            console.error("handleAuth: Exception:", error);
            if (error.message.includes('Email not confirmed')) {
                showToast("Debes confirmar tu email antes de entrar. Revisa tu bandeja de entrada (y spam).", "error");
                setShowResend(true);
            } else {
                showToast(error.message, "error");
            }
        } finally {
            setAuthLoading(false);
        }
    };

    const handleResendConfirmation = async () => {
        setAuthLoading(true);
        try {
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email: authEmail,
                options: {
                    emailRedirectTo: window.location.origin
                }
            });
            if (error) throw error;
            showToast("Email de confirmación reenviado. Revisa tu correo.", "success");
            setShowResend(false);
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        showToast("Sesión cerrada");
    };

    const handleResetDatabase = async () => {
        const confirm1 = window.confirm("⚠️ ZONA PELIGROSA: Esta acción eliminará TODOS los alumnos, pagos, notificaciones y gastos de este espacio de trabajo. Esta acción no se puede deshacer.\n\n¿Estás seguro?");
        if (!confirm1) return;
        const confirm2 = window.confirm("¿Confirmas que quieres BORRAR TODOS LOS DATOS permanentemente?");
        if (!confirm2) return;
        try {
            const wid = userWorkspace.id;
            await supabase.from('payments').delete().eq('workspace_id', wid);
            await supabase.from('notifications').delete().eq('workspace_id', wid);
            await supabase.from('expenses').delete().eq('workspace_id', wid);
            await supabase.from('workspace_configs').delete().eq('workspace_id', wid);
            await supabase.from('personnel').delete().eq('workspace_id', wid);
            await supabase.from('students').delete().eq('workspace_id', wid);
            showToast("Base de datos borrada correctamente.", "success");
            fetchAppData(session.user);
        } catch (err) {
            console.error("Error resetting DB:", err);
            showToast("Error al borrar los datos.", "error");
        }
    };

    const handleDeleteAdmin = async () => {
        const confirm1 = window.confirm("⚠️ ZONA PELIGROSA: Esto eliminará tu cuenta de administrador y TODOS los datos del espacio de trabajo de forma permanente. Esta acción no se puede deshacer.\n\n¿Estás absolutamente seguro?");
        if (!confirm1) return;
        const typed = window.prompt("Para confirmar, escribe ELIMINAR:");
        if (typed !== "ELIMINAR") { showToast("Cancelado. La palabra no coincide.", "info"); return; }
        try {
            const wid = userWorkspace.id;
            await supabase.from('payments').delete().eq('workspace_id', wid);
            await supabase.from('notifications').delete().eq('workspace_id', wid);
            await supabase.from('expenses').delete().eq('workspace_id', wid);
            await supabase.from('workspace_configs').delete().eq('workspace_id', wid);
            await supabase.from('personnel').delete().eq('workspace_id', wid);
            await supabase.from('students').delete().eq('workspace_id', wid);
            await supabase.from('workspace_members').delete().eq('workspace_id', wid);
            await supabase.from('workspaces').delete().eq('id', wid);
            await supabase.auth.signOut();
        } catch (err) {
            console.error("Error deleting admin:", err);
            showToast("Error al eliminar la cuenta.", "error");
        }
    };

    const saveSalaryData = async (person) => {
        try {
            const { error } = await supabase
                .from('workspace_configs')
                .upsert({
                    workspace_id: userWorkspace.id,
                    config_key: `salary_${person}`,
                    config_value: salaryData[person]
                }, { onConflict: 'workspace_id, config_key' });

            if (error) throw error;
            showToast(`Datos de ${person.toUpperCase()} guardados en la nube`);
        } catch (error) {
            console.error("Error saving salary config:", error);
            showToast("Error al guardar en la nube", "error");
        }
    };

    const addExpense = async () => {
        if (!newExpense.description || !newExpense.amount) {
            showToast("Por favor, completa la descripción y el monto", "error");
            return;
        }
        try {
            const { error } = await supabase
                .from('expenses')
                .insert([{
                    workspace_id: userWorkspace.id,
                    description: newExpense.description,
                    amount: parseFloat(newExpense.amount),
                    category: 'Operativo'
                }]);

            if (error) throw error;
            setNewExpense({ description: '', amount: '' });
            fetchAppData(session.user);
            showToast("Gasto agregado");
        } catch (error) {
            console.error("Error adding expense:", error);
            showToast("Error al guardar gasto", "error");
        }
    };

    const deleteExpense = async (id) => {
        try {
            const { error } = await supabase
                .from('expenses')
                .delete()
                .eq('id', id);

            if (error) throw error;
            fetchAppData(session.user);
            showToast("Gasto eliminado", "error");
        } catch (error) {
            console.error("Error deleting expense:", error);
            showToast("Error al eliminar gasto", "error");
        }
    };

    const inviteAdmin = async (email) => {
        if (!email) {
            showToast("El email es requerido", "error");
            return;
        }
        try {
            const { error } = await supabase
                .from('workspace_invites')
                .insert([{ workspace_id: userWorkspace.id, email, role: 'admin' }]);

            if (error) throw error;
            showToast(`Invitación enviada a ${email}`);
            setInviteEmail('');
            fetchWorkspaceAdmins();
        } catch (error) {
            console.error("Error inviting admin:", error);
            showToast("Error al enviar invitación", "error");
        }
    };

    const [workspaceAdmins, setWorkspaceAdmins] = useState({ members: [], invites: [] });
    const [inviteEmail, setInviteEmail] = useState('');

    const fetchWorkspaceAdmins = async () => {
        if (!userWorkspace) return;
        const { data } = await supabase
            .from('workspace_members')
            .select('id, role, profiles(full_name), user_id')
            .eq('workspace_id', userWorkspace.id);

        const { data: invites } = await supabase
            .from('workspace_invites')
            .select('id, email, role')
            .eq('workspace_id', userWorkspace.id);

        setWorkspaceAdmins({ members: data || [], invites: invites || [] });
    };

    useEffect(() => {
        if (userWorkspace && currentView === 'ajustes') {
            fetchWorkspaceAdmins();
        }
    }, [userWorkspace, currentView]);

    const sendNotification = async () => {
        if (!newNotification.title || !newNotification.message) {
            showToast("Por favor, completa título y mensaje", "error");
            return;
        }
        try {
            const { error } = await supabase
                .from('notifications')
                .insert([{
                    workspace_id: userWorkspace.id,
                    title: newNotification.title,
                    message: newNotification.message,
                    type: newNotification.type,
                    target: newNotification.target
                }]);

            if (error) throw error;

            setNewNotification({ title: '', message: '', type: 'General', target: 'Todos' });
            fetchAppData(session.user);
            showToast("Notificación enviada");
        } catch (error) {
            console.error("Error sending notification:", error);
            showToast("Error al enviar notificación", "error");
        }
    };

    const deleteNotification = async (id) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .delete()
                .eq('id', id);

            if (error) throw error;
            fetchAppData(session.user);
            showToast("Notificación eliminada", "error");
        } catch (error) {
            console.error("Error deleting notification:", error);
            showToast("Error al eliminar notificación", "error");
        }
    };

    const showToast = (message, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    // Salary/Honorarios State - Dynamic Personnel
    const [salaryData, setSalaryData] = useState([]);
    const [personnelList, setPersonnelList] = useState([]); // Array of {id, name}
    const [editWorkspaceName, setEditWorkspaceName] = useState('');
    const [editAdminName, setEditAdminName] = useState('');
    const [newPersonName, setNewPersonName] = useState('');

    const [newStudent, setNewStudent] = useState({
        name: '',
        classesPerWeek: '2',
        entryDate: new Date().toISOString().split('T')[0],
        phone: '',
        initialAmount: '',
        initialReceiver: '',
        dni: '',
        birthDate: '',
        address: '',
        physicalAptitudeUrl: null,
        dniUrl: null
    });
    const [capturedDniPreview, setCapturedDniPreview] = useState(''); // instant preview, set sync at capture
    const [expensesData, setExpensesData] = useState([]);
    const [newExpense, setNewExpense] = useState({ description: '', amount: '' });
    const [editingExpenseId, setEditingExpenseId] = useState(null);
    const [editExpenseData, setEditExpenseData] = useState({ description: '', amount: '' });
    const [fileExpenses, setFileExpenses] = useState([]);
    const fileInputRef = useRef(null);

    // Initialization on Mount
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (token) {
            setRegistrationToken(token);
            setIsStudentMode(true);
            fetchStudentData(token);
        }
    }, []);

    const fetchStudentData = async (token) => {
        setIsInitialLoad(true);
        try {
            const { data, error } = await supabase
                .from('students')
                .select('*, payments(*), workspaces(*)')
                .eq('registration_token', token)
                .single();

            if (data) {
                const formatted = {
                    id: data.id,
                    name: data.name,
                    entryDate: data.entry_date,
                    classesPerWeek: data.classes_per_week,
                    phone: data.phone,
                    status: data.status,
                    registrationToken: data.registration_token,
                    dni: data.dni,
                    birthDate: data.birth_date,
                    address: data.address,
                    physicalAptitudeUrl: data.physical_aptitude_url,
                    history: (data.payments || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(p => ({
                        month: p.month,
                        amount: p.amount.toString(),
                        receivedBy: p.received_by,
                        date: new Date(p.created_at).toLocaleDateString()
                    }))
                };
                setCurrentStudent(formatted);
                setUserWorkspace(data.workspaces);
                setClientType(data.workspaces.client_type || 'alumnos');
                // Also add to students array so other code that does students.find() works
                setStudents([formatted]);

                // Fetch notifications for this workspace
                const { data: notifs } = await supabase
                    .from('notifications')
                    .select('*')
                    .eq('workspace_id', data.workspace_id)
                    .order('created_at', { ascending: false });

                setNotifications(notifs || []);
                setIsLoaded(true);
            }
        } catch (err) {
            console.error("Error fetching student data:", err);
        } finally {
            setIsInitialLoad(false);
        }
    };

    // Automated Notifications for Fee Expiry
    useEffect(() => {
        const checkExpiries = () => {
            const today = new Date();
            const newAutoNotifs = [];

            students.forEach(student => {
                if (student.status !== 'activo') return;

                const hasPaid = hasPaidCurrentMonth(student);
                if (!hasPaid) {
                    // Check if notification already exists for this student this month
                    const monthYear = `${today.getMonth()}-${today.getFullYear()}`;
                    const notifId = `fee-alert-${student.id}-${monthYear}`;

                    const alreadyNotified = notifications.find(n => n.id === notifId);

                    if (!alreadyNotified) {
                        newAutoNotifs.push({
                            id: notifId,
                            title: "Vencimiento de Cuota",
                            message: `Hola ${student.name}, te recordamos que tu cuota de ${today.toLocaleString('es-ES', { month: 'long' })} está próxima a vencer.`,
                            type: "Vencimiento de cuota",
                            target: student.id, // Target specific student
                            date: new Date().toISOString()
                        });
                    }
                }
            });

            if (newAutoNotifs.length > 0) {
                setNotifications(prev => [...newAutoNotifs, ...prev]);
            }
        };

        const timer = setTimeout(checkExpiries, 5000); // Check 5 seconds after load
        return () => clearTimeout(timer);
    }, [students, notifications]);

    const addPerson = async (name) => {
        if (!name.trim()) return;
        const newPerson = { id: Date.now().toString(), name: name.trim() };
        const updatedList = [...personnelList, newPerson];
        setPersonnelList(updatedList);
        setNewPersonName('');

        await supabase.from('workspace_configs').upsert({
            workspace_id: userWorkspace.id,
            config_key: 'personnel_list',
            config_value: updatedList
        });
        showToast("Personal agregado");
    };

    const removePerson = async (id) => {
        const updatedList = personnelList.filter(p => p.id !== id);
        setPersonnelList(updatedList);
        await supabase.from('workspace_configs').upsert({
            workspace_id: userWorkspace.id,
            config_key: 'personnel_list',
            config_value: updatedList
        });
        showToast("Personal eliminado", "error");
    };

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
                showToast('Por favor, asegúrate de que el link sea de una planilla de Google Sheets válida.', 'error');
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

            const text = await response.text();

            // Critical check: If we got HTML, it's likely a Google Login redirect (Private sheet)
            if (text.trim().startsWith('<!DOCTYPE html') || text.trim().startsWith('<html')) {
                throw new Error('La planilla es privada. En Google Sheets, haz clic en "Compartir" y cambia el acceso a "Cualquier persona con el vínculo" (Lector).');
            }

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
            event.target.value = ''; // Reset input to allow re-upload of the same file
            showToast('¡Datos cargados con éxito!');
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            event.target.value = ''; // Also reset on error
            showToast(`Error al procesar el archivo: ${error.message}. Asegúrate de que sea el formato de exportación esperado.`, 'error');
        }
    };

    const addStudent = async () => {
        if (!newStudent.name.trim()) {
            showToast("Por favor, ingresa un nombre", "error");
            return;
        }
        if (/^\d+$/.test(newStudent.name.trim())) {
            showToast("El nombre no puede ser solo números", "error");
            return;
        }
        if (newStudent.phone) {
            const phoneRegex = /^[0-9+\s\-()]{8,20}$/;
            if (!phoneRegex.test(newStudent.phone)) {
                showToast("El teléfono debe tener entre 8 y 20 caracteres (solo números y símbolos + - ( ))", "error");
                return;
            }
        }
        if (newStudent.initialAmount && isNaN(parseFloat(newStudent.initialAmount))) {
            showToast("El monto inicial debe ser un número válido", "error");
            return;
        }

        try {
            const token = btoa(`${newStudent.name.trim()}-${Date.now()}`).replace(/=/g, '');
            const studentToInsert = {
                workspace_id: userWorkspace.id,
                name: newStudent.name.trim(),
                classes_per_week: parseInt(newStudent.classesPerWeek),
                entry_date: newStudent.entryDate,
                phone: newStudent.phone || null,
                dni: newStudent.dni || null,
                birth_date: newStudent.birthDate || null,
                dni_url: newStudent.dniUrl || null,
                status: 'activo',
                registration_token: token
            };

            const { data: insertedStudent, error } = await supabase
                .from('students')
                .insert([studentToInsert])
                .select()
                .single();

            if (error) throw error;

            // Handle initial payment if present
            if (newStudent.initialAmount) {
                const { error: pError } = await supabase
                    .from('payments')
                    .insert([{
                        student_id: insertedStudent.id,
                        workspace_id: userWorkspace.id,
                        amount: parseFloat(newStudent.initialAmount),
                        month: new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
                        received_by: newStudent.initialReceiver,
                        payment_type: 'Cuota'
                    }]);
                if (pError) throw pError;
            }

            // Refresh app data
            fetchAppData(session.user);

            setNewStudent({ name: '', classesPerWeek: '2', entryDate: new Date().toISOString().split('T')[0], phone: '', initialAmount: '', initialReceiver: '' });
            setShowAddModal(false);

            if (window.confirm("¿Deseas generar un link para que el alumno complete sus datos adicionales (DNI, Dirección, etc)?")) {
                const baseUrl = window.location.origin + window.location.pathname;
                const fullLink = `${baseUrl}?token=${token}`;
                setGeneratedLink(fullLink);
                setPhoneToAdd(newStudent.phone || '');
                setShowPhoneAddModal(true);

                // Auto-open WhatsApp with welcome message if phone exists
                if (newStudent.phone) {
                    const welcomeMsg = encodeURIComponent(`¡Hola ${newStudent.name}! Bienvenid@ a Gestión Flex. Para completar tu inscripción, por favor ingresa a este link: ${fullLink}`);
                    window.open(`https://wa.me/${newStudent.phone.replace(/\D/g, '')}?text=${welcomeMsg}`, '_blank');
                }
            } else {
                showToast("Alumno agregado correctamente");
            }
        } catch (error) {
            console.error("Error adding student:", error);
            showToast("Error al guardar el alumno en la nube", "error");
        }
    };

    const generateRegistrationLink = async (phone) => {
        if (!phone) {
            showToast("El número de teléfono es requerido", "error");
            return;
        }

        try {
            const token = btoa(`${phone}-${Date.now()}`).replace(/=/g, '');
            const { data: insertedStudent, error } = await supabase
                .from('students')
                .insert([{
                    workspace_id: userWorkspace.id,
                    name: `Alumno (vía ${phone})`,
                    phone: phone,
                    status: 'pendiente',
                    registration_token: token,
                    classes_per_week: 2, // Default
                    entry_date: new Date().toISOString().split('T')[0]
                }])
                .select()
                .single();

            if (error) throw error;

            const baseUrl = window.location.origin + window.location.pathname;
            const fullLink = `${baseUrl}?token=${token}`;
            setGeneratedLink(fullLink);

            // WhatsApp Welcome
            const welcomeMsg = encodeURIComponent(`¡Hola! Bienvenid@ a Gestión Flex. Para completar tu inscripción, por favor ingresa a este link: ${fullLink}`);
            window.open(`https://wa.me/${phone}?text=${welcomeMsg}`, '_blank');

            // Refresh
            fetchAppData(session.user);
            showToast("Link de invitación generado");
        } catch (error) {
            console.error("Error generating link:", error);
            showToast("Error al generar link en la nube", "error");
        }
    };

    const handleResetData = async () => {
        if (!userWorkspace) return;
        if (window.confirm('⚠️ ¿ESTÁS SEGURO? Esta acción borrará permanentemente TODOS los datos de ESTE espacio de trabajo en la nube.')) {
            try {
                // Delete students (cascades to payments)
                const { error: sError } = await supabase
                    .from('students')
                    .delete()
                    .eq('workspace_id', userWorkspace.id);
                if (sError) throw sError;

                // Delete expenses
                const { error: eError } = await supabase
                    .from('expenses')
                    .delete()
                    .eq('workspace_id', userWorkspace.id);
                if (eError) throw eError;

                // Delete notifications
                const { error: nError } = await supabase
                    .from('notifications')
                    .delete()
                    .eq('workspace_id', userWorkspace.id);
                if (nError) throw nError;

                // Clear configs
                const { error: cError } = await supabase
                    .from('workspace_configs')
                    .delete()
                    .eq('workspace_id', userWorkspace.id);
                if (cError) throw cError;

                showToast('Datos del workspace eliminados por completo.', 'error');
                fetchAppData(session.user);
            } catch (error) {
                console.error("Error resetting data:", error);
                showToast("Error al resetear datos en la nube", "error");
            }
        }
    };

    const deleteStudent = async (studentId, event) => {
        event.stopPropagation();
        if (window.confirm("¿Seguro que deseas eliminar este alumno? Se borrará todo su historial.")) {
            try {
                const { error } = await supabase
                    .from('students')
                    .delete()
                    .eq('id', studentId);

                if (error) throw error;

                fetchAppData(session.user);
                showToast("Alumno eliminado");
                if (selectedStudent && selectedStudent.id === studentId) {
                    setSelectedStudent(null);
                }
            } catch (error) {
                console.error("Error deleting student:", error);
                showToast("Error al eliminar alumno en la nube", "error");
            }
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
        setNewPayment({ month: currentMonth, amount: '', receivedBy: personnelList[0]?.name || '' });
        setShowPaymentModal(true);
    };

    const confirmPayment = async () => {
        const { month, amount, receivedBy } = newPayment;
        if (!month || !amount) {
            showToast("Por favor, completa el mes y el monto", "error");
            return;
        }
        if (isNaN(parseFloat(amount))) {
            showToast("El monto debe ser un número válido", "error");
            return;
        }

        try {
            const { error } = await supabase
                .from('payments')
                .insert([{
                    student_id: paymentStudentId,
                    workspace_id: userWorkspace.id,
                    amount: parseFloat(amount),
                    month,
                    received_by: receivedBy,
                    payment_type: 'Cuota'
                }]);

            if (error) throw error;

            fetchAppData(session.user);
            setShowPaymentModal(false);
            showToast("Pago registrado correctamente");
        } catch (error) {
            console.error("Error recording payment:", error);
            showToast("Error al registrar pago en la nube", "error");
        }
    };

    const saveWorkspaceBranding = async () => {
        if (!userWorkspace) return;
        try {
            const { error } = await supabase
                .from('workspaces')
                .update({ name: editWorkspaceName })
                .eq('id', userWorkspace.id);
            if (error) throw error;
            setUserWorkspace({ ...userWorkspace, name: editWorkspaceName });
            showToast("Nombre del espacio actualizado");
        } catch (err) {
            console.error("Error saving workspace branding:", err);
            showToast("Error al guardar marca del espacio", "error");
        }
    };

    const saveAdminName = async () => {
        if (!session?.user) return;
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ full_name: editAdminName })
                .eq('id', session.user.id);
            if (error) throw error;
            showToast("Perfil de administrador actualizado");
            // Refresh to update defaults
            fetchAppData(session.user);
        } catch (err) {
            console.error("Error saving admin name:", err);
            showToast("Error al guardar perfil", "error");
        }
    };

    const updateSalary = (personId, field, value) => {
        setSalaryData(prev => {
            const index = prev.findIndex(s => s.personId === personId);
            if (index === -1) {
                return [...prev, { personId, hours: 0, hourlyValue: 0, advances: 0, [field]: value }];
            }
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    const saveSalaries = async () => {
        if (!userWorkspace) return;
        try {
            const { error } = await supabase
                .from('workspace_configs')
                .upsert({
                    workspace_id: userWorkspace.id,
                    config_key: 'salary_data',
                    config_value: salaryData
                });

            if (error) throw error;
            showToast("Sueldos guardados correctamente");
        } catch (error) {
            console.error("Error saving salaries:", error);
            showToast("Error al guardar sueldos en la nube", "error");
        }
    };

    const saveStudentChanges = async () => {
        if (!selectedStudent) return;
        try {
            const { error } = await supabase
                .from('students')
                .update({
                    name: selectedStudent.name,
                    classes_per_week: parseInt(selectedStudent.classesPerWeek),
                    entry_date: selectedStudent.entryDate,
                    phone: selectedStudent.phone,
                    dni: selectedStudent.dni,
                    birth_date: selectedStudent.birthDate,
                    address: selectedStudent.address,
                    physical_aptitude_url: selectedStudent.physicalAptitudeUrl
                })
                .eq('id', selectedStudent.id);

            if (error) throw error;

            fetchAppData(session.user);
            showToast("Cambios guardados con éxito");
        } catch (error) {
            console.error("Error saving student:", error);
            showToast("Error al guardar cambios en la nube", "error");
        }
    };

    const updateStudentField = (field, value) => {
        setSelectedStudent({ ...selectedStudent, [field]: value });
    };

    const calculateTotals = () => {
        let totalMoney = 0;
        let totalClasses = 0;
        let totalPayments = 0;

        students.forEach(s => {
            totalClasses += parseInt(s.classesPerWeek) || 0;
            s.history.forEach(h => {
                const amount = cleanMoneyString(h.amount);
                totalMoney += amount;
                totalPayments++;
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

        // Salary calculations - Dynamic
        let totalHonorarios = 0;
        if (Array.isArray(salaryData)) {
            salaryData.forEach(d => {
                totalHonorarios += (d.hours * d.hourlyValue);
            });
        }

        // Operational Expenses only (Manual + Planilla)
        const totalExpenses = manualExpenses + autoExpensesValue;

        // User Logic: Net Profit = Income - Operational Expenses (excluding salaries)
        const netProfit = totalMoney - totalExpenses;

        return { totalMoney, totalClasses, totalPayments, activeStudents, averagePerStudent, totalExpenses, totalHonorarios, netProfit };
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
            filename = `Alumnos-Gestion-Flex-${new Date().toISOString().split('T')[0]}.xlsx`;
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
            personnelList.forEach(p => {
                const d = salaryData.find(s => s.personId === p.id) || { hours: 0, hourlyValue: 0, advances: 0 };
                const sueldo = d.hours * d.hourlyValue;
                rows.push([p.name.toUpperCase(), d.hours, `$ ${d.hourlyValue.toLocaleString()}`, `$ ${sueldo.toLocaleString()}`, `$ ${d.advances.toLocaleString()}`, `$ ${(sueldo - d.advances).toLocaleString()}`]);
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

            rows.push(["TOTAL DE GASTOS", `$ ${totals.totalExpenses.toLocaleString()}`]);

            // Final Summary Balance
            rows.push([]);
            rows.push(["RESUMEN DE RESULTADOS"]);
            rows.push(["INGRESOS TOTALES", `$ ${totals.totalMoney.toLocaleString()}`]);
            rows.push(["GASTOS TOTALES", `$ ${totals.totalExpenses.toLocaleString()}`]);
            rows.push(["GANANCIA NETA (INGRESOS - GASTOS)", `$ ${totals.netProfit.toLocaleString()}`]);
            rows.push(["HONORARIOS PROFESORES (DETALLE)", `$ ${totals.totalHonorarios.toLocaleString()}`]);

            filename = `Reporte-Finanzas-Gestion-Flex-${new Date().toISOString().split('T')[0]}.xlsx`;
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
        doc.text("Resumen de Gestión - Gestión Flex", 14, 20);
        doc.setFontSize(11);
        doc.text(`Fecha de generación: ${new Date().toLocaleDateString()}`, 14, 30);

        // Financial Summary Table
        const financialHeaders = [["Concepto", "Valor"]];
        const financialData = [
            ["Recaudación Total", `$${totals.totalMoney.toLocaleString()}`],
            ["Total Alumnos", students.length.toString()],
            ["Total Clases por Sem.", totals.totalClasses.toString()]
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
        const salaryRows = personnelList.map(p => {
            const d = salaryData.find(s => s.personId === p.id) || { hours: 0, hourlyValue: 0, advances: 0 };
            const sueldo = d.hours * d.hourlyValue;
            return [p.name.toUpperCase(), `${d.hours}hs`, `$${d.hourlyValue.toLocaleString()}`, `$${sueldo.toLocaleString()}`, `$${d.advances.toLocaleString()}`, `$${(sueldo - d.advances).toLocaleString()}`];
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
        expenseRows.push([{ content: 'HONORARIOS (Sueldos)', styles: { fontStyle: 'italic' } }, { content: `$${totals.totalHonorarios.toLocaleString()}`, styles: { fontStyle: 'italic' } }, 'Cálculo Auto', '-']);
        expenseRows.push([{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, { content: `$${totals.totalExpenses.toLocaleString()}`, styles: { fontStyle: 'bold', textColor: [239, 68, 68] } }, '', '']);

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 20,
            head: expenseHeaders,
            body: expenseRows,
            theme: 'striped'
        });

        // Final Balance
        doc.setFontSize(16);
        const finalY = doc.lastAutoTable.finalY + 20;
        doc.text(`GANANCIA NETA (Ingresos - Gastos): $${totals.netProfit.toLocaleString()}`, 14, finalY);
        doc.setFontSize(12);
        doc.text(`Honorarios Profesores: $${totals.totalHonorarios.toLocaleString()}`, 14, finalY + 10);

        // Students Table
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

        doc.save(`Gestion-Flex-Reporte-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    const exportStudentPDF = (student) => {
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text(`Ficha de Alumno: ${student.name}`, 14, 20);
        doc.setFontSize(11);
        doc.text(`Clases por semana: ${student.classesPerWeek}`, 14, 30);
        doc.text(`Fecha de ingreso: ${student.entryDate}`, 14, 35);
        const historyHeaders = [["Mes", "Monto", "Recibió", "Fecha de Pago"]];
        const historyRows = student.history.map(h => [h.month, h.amount, h.receivedBy, h.date]);
        doc.autoTable({
            startY: 45,
            head: historyHeaders,
            body: historyRows,
            theme: 'striped',
            headStyles: { fillStyle: '#6366f1' }
        });
        doc.save(`Ficha-${student.name.replace(/\s+/g, '-')}.pdf`);
    };

    useEffect(() => {
        if (showCamera) {
            startCamera();
        } else {
            stopCamera();
        }
        return () => stopCamera();
    }, [showCamera]);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                streamRef.current = stream;
            }
        } catch (err) {
            console.error("Error accessing camera:", err);
            showToast("Error al acceder a la cámara", "error");
            setShowCamera(false);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    };

    const handleCameraCapture = async () => {
        if (!videoRef.current) {
            showToast("Error: cámara no disponible", "error");
            return;
        }

        const video = videoRef.current;

        // Guard: video must be playing and have dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
            showToast("La cámara aún no está lista, esperá un segundo e intentá de nuevo", "error");
            return;
        }

        setOcrLoading(true);

        try {
            // 1. Capture frame to canvas
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            // 2. Get dataURL immediately (synchronous - always works)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

            // Set preview IMMEDIATELY so user sees the photo right away
            setCapturedDniPreview(dataUrl);

            // 3. Convert to blob for OCR and upload
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')), 'image/jpeg', 0.92);
            });

            stopCamera();
            setShowCamera(false);
            showToast("📷 Foto capturada. Procesando OCR...", "info");

            // 4. Try upload to Supabase (non-blocking - won't stop the flow if fails)
            let savedUrl = dataUrl; // fallback to local dataURL
            const fileName = `dni_${registrationToken || 'admin'}_${Date.now()}.jpg`;
            try {
                const { error: uploadError } = await supabase.storage
                    .from('documents')
                    .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

                if (!uploadError) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('documents')
                        .getPublicUrl(fileName);
                    savedUrl = publicUrl;
                } else {
                    console.warn("Upload failed (non-critical):", uploadError.message);
                }
            } catch (uploadErr) {
                console.warn("Upload exception (non-critical):", uploadErr);
            }

            // 5. Always save the photo URL (local or remote)
            if (isStudentMode) {
                setStudentData(prev => ({ ...prev, dniUrl: savedUrl }));
            } else {
                setNewStudent(prev => ({ ...prev, dniUrl: savedUrl }));
            }

            // 6. Run OCR - preprocess image first for better results
            showToast("🔍 Leyendo DNI con OCR...", "info");
            let parsedData = {};
            try {
                // Preprocess: create a high-contrast grayscale version of the canvas
                const processedCanvas = document.createElement('canvas');
                processedCanvas.width = canvas.width * 2; // upscale for better OCR
                processedCanvas.height = canvas.height * 2;
                const pCtx = processedCanvas.getContext('2d');
                pCtx.filter = 'grayscale(100%) contrast(180%) brightness(110%)';
                pCtx.drawImage(canvas, 0, 0, processedCanvas.width, processedCanvas.height);

                const processedBlob = await new Promise(resolve =>
                    processedCanvas.toBlob(resolve, 'image/png')
                );

                // Try with spa+eng for Argentine DNIs
                const result = await Tesseract.recognize(processedBlob, 'spa+eng', {
                    logger: () => { }
                });
                const text = result.data.text;
                console.log("OCR raw text:", JSON.stringify(text));
                parsedData = parseDNIText(text);
            } catch (ocrErr) {
                console.error("OCR error:", ocrErr);
            }

            // 7. Populate form fields
            if (isStudentMode) {
                setStudentData(prev => ({
                    ...prev,
                    dniUrl: savedUrl,
                    ...(parsedData.name && { name: parsedData.name }),
                    ...(parsedData.dni && { dni: parsedData.dni }),
                    ...(parsedData.birthDate && { birthDate: parsedData.birthDate }),
                }));
            } else {
                setNewStudent(prev => ({
                    ...prev,
                    dniUrl: savedUrl,
                    name: parsedData.name || prev.name,
                    dni: parsedData.dni || prev.dni,
                    birthDate: parsedData.birthDate || prev.birthDate,
                }));
            }

            // 8. Always show result feedback
            if (parsedData.dni || parsedData.name) {
                showToast(`✅ Datos extraídos: ${[parsedData.name, parsedData.dni].filter(Boolean).join(' · ')}`, "success");
            } else {
                showToast("📄 Foto guardada. No se reconocieron datos automáticamente — completá los campos a mano.", "info");
            }

        } catch (err) {
            console.error("Error in capture:", err);
            showToast("Error al capturar: " + err.message, "error");
            setShowCamera(false);
        } finally {
            setOcrLoading(false);
        }
    };

    const parseDNIText = (text) => {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const data = { dni: '', name: '', birthDate: '' };

        // 1. DNI (8 digits, optional dots)
        const dniMatch = text.match(/\b\d{1,2}\.?\d{3}\.?\d{3}\b/);
        if (dniMatch) data.dni = dniMatch[0].replace(/\./g, '');

        // 2. Birth Date (DD/MM/YYYY or DD-MM-YYYY)
        const dateMatch = text.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
        if (dateMatch) {
            const [_, day, month, year] = dateMatch;
            data.birthDate = `${year}-${month}-${day}`;
        }

        // 3. Name (Look for APELLIDO/NOMBRE and take following ALL CAPS lines)
        const nameKeywords = ["APELLIDO", "NOMBRE", "APELLIDOS", "NOMRE", "NOMBRES"];
        const nameLines = [];

        lines.forEach((line, idx) => {
            const up = line.toUpperCase();
            if (nameKeywords.some(k => up.includes(k)) && !up.includes("NACIMIENTO")) {
                let nextIdx = idx + 1;
                // Capture up to 3 lines of ALL CAPS text that aren't keywords
                while (lines[nextIdx] &&
                    lines[nextIdx] === lines[nextIdx].toUpperCase() &&
                    lines[nextIdx].length > 2 &&
                    !nameKeywords.some(k => lines[nextIdx].toUpperCase().includes(k))) {
                    nameLines.push(lines[nextIdx]);
                    nextIdx++;
                    if (nameLines.length >= 3) break;
                }
            }
        });

        if (nameLines.length > 0) {
            data.name = nameLines.join(' ').trim();
        }

        return data;
    };

    const handleFileUploadToStorage = async (file, type) => {
        if (!file) return;
        const fileName = `${type}_${registrationToken || Date.now()}_${file.name}`;
        try {
            const { data, error } = await supabase.storage
                .from('documents')
                .upload(fileName, file);

            if (error) throw error;

            const { data: { publicUrl } } = supabase.storage
                .from('documents')
                .getPublicUrl(fileName);

            setStudentData(prev => ({
                ...prev,
                [type === 'dni' ? 'dniUrl' : 'physicalAptitudeUrl']: publicUrl
            }));
            showToast("Archivo subido correctamente");
        } catch (err) {
            console.error("Error uploading file:", err);
            showToast("Error al subir archivo", "error");
        }
    };

    const finishStudentRegistration = async () => {
        try {
            // In student mode, the loaded student is in the students array (populated by fetchStudentData)
            // Use registrationToken to find them, with a direct DB fetch as fallback
            let studentToUpdate = students.find(s => s.registrationToken === registrationToken);

            if (!studentToUpdate) {
                // Fallback: fetch directly from DB by token
                const { data: dbStudent, error: dbErr } = await supabase
                    .from('students')
                    .select('id, name, classes_per_week')
                    .eq('registration_token', registrationToken)
                    .single();
                if (dbErr || !dbStudent) throw new Error('No se encontró el registro del alumno');
                studentToUpdate = { id: dbStudent.id, name: dbStudent.name, classesPerWeek: dbStudent.classes_per_week };
            }

            const { error } = await supabase
                .from('students')
                .update({
                    name: studentData.name || studentToUpdate.name,
                    dni: studentData.dni,
                    birth_date: studentData.birthDate,
                    address: studentData.address,
                    physical_aptitude_url: studentData.physicalAptitudeUrl,
                    dni_url: studentData.dniUrl,
                    disciplina: studentData.disciplina,
                    horario: studentData.horario,
                    classes_per_week: parseInt(studentData.classes_per_week || studentToUpdate.classesPerWeek),
                    status: 'activo',
                    registration_token: null // Consume token
                })
                .eq('id', studentToUpdate.id);

            if (error) throw error;

            // Fetch the updated student by ID
            const { data: updatedStudent, error: fetchError } = await supabase
                .from('students')
                .select('*, payments(*)')
                .eq('id', studentToUpdate.id)
                .single();

            if (fetchError) throw fetchError;

            // Map the updated student data into React state
            const mapped = {
                id: updatedStudent.id,
                name: updatedStudent.name,
                dni: updatedStudent.dni,
                birthDate: updatedStudent.birth_date,
                address: updatedStudent.address,
                physicalAptitudeUrl: updatedStudent.physical_aptitude_url,
                dniUrl: updatedStudent.dni_url,
                disciplina: updatedStudent.disciplina,
                horario: updatedStudent.horario,
                classesPerWeek: updatedStudent.classes_per_week,
                status: updatedStudent.status,
                entryDate: updatedStudent.entry_date,
                registrationToken: null,
                history: (updatedStudent.payments || []).map(p => ({
                    id: p.id,
                    month: p.month,
                    amount: p.amount?.toString(),
                    receivedBy: p.received_by,
                    date: p.payment_date
                }))
            };

            setStudents(prev => prev.map(s => s.id === mapped.id ? mapped : s));
            showToast("¡Registro completado con éxito! Bienvenid@.", "success");
            setStudentStep(3); // Go to dashboard
        } catch (error) {
            console.error("Error finishing registration:", error);
            showToast("Error al completar el registro: " + error.message, "error");
        }
    };

    if (isInitialLoad) {
        return <div className="loading-screen">Cargando {userWorkspace?.name || 'Gestión Flex'}...</div>;
    }

    if (!supabase) {
        return (
            <div className="auth-container" style={{ textAlign: 'center', flexDirection: 'column', gap: '2rem' }}>
                <div className="auth-card animate-fade-in" style={{ maxWidth: '600px' }}>
                    <div className="auth-header">
                        <AlertCircle size={48} color="#ef4444" style={{ marginBottom: '1rem' }} />
                        <h2>Configuración Requerida</h2>
                        <p>No se detectaron las credenciales de conexión con la base de datos.</p>
                    </div>

                    <div className="report-card" style={{ textAlign: 'left', background: '#f8fafc' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Sigue estos pasos en Vercel:</h3>
                        <ol style={{ paddingLeft: '1.2rem', lineHeight: '1.6', fontSize: '0.95rem' }}>
                            <li>Ve al dashboard de <strong>Vercel</strong> y selecciona este proyecto.</li>
                            <li>Entra en <strong>Settings</strong> {'->'} <strong>Environment Variables</strong>.</li>
                            <li>Crea una variable llamada <code>VITE_SUPABASE_URL</code> con tu URL de Supabase.</li>
                            <li>Crea otra llamada <code>VITE_SUPABASE_ANON_KEY</code> con tu Anon Key.</li>
                            <li>Ve a la pestaña <strong>Deployments</strong> y elige <strong>Redeploy</strong> en el último envío.</li>
                        </ol>
                    </div>

                    <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        Si estás en desarrollo local, asegúrate de tener un archivo <code>.env</code> con estas variables.
                    </p>
                </div>
            </div>
        );
    }

    if (!session && !isStudentMode) {
        return (
            <div className="auth-container">
                <div className="auth-card animate-fade-in">
                    <div className="auth-header">
                        <div className="auth-logo">
                            <h1>{userWorkspace?.name || 'Gestión Flex'}</h1>
                        </div>
                        <h2>{authMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
                        <p>{authMode === 'login' ? 'Bienvenido de nuevo' : `Únete a ${userWorkspace?.name || 'Gestión Flex'} hoy`}</p>
                    </div>

                    <form className="auth-form" onSubmit={handleAuth}>
                        <div className="form-group">
                            <label><Mail size={16} /> Email</label>
                            <input
                                type="email"
                                required
                                value={authEmail}
                                onChange={e => setAuthEmail(e.target.value)}
                                placeholder="tu@email.com"
                            />
                        </div>
                        <div className="form-group">
                            <label><Lock size={16} /> Contraseña</label>
                            <input
                                type="password"
                                required
                                value={authPassword}
                                onChange={e => setAuthPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>

                        <button className="btn-confirm-full" type="submit" disabled={authLoading}>
                            {authLoading ? 'Procesando...' : (authMode === 'login' ? 'Entrar' : 'Registrarse')}
                        </button>

                        {showResend && authMode === 'login' && (
                            <button
                                type="button"
                                className="btn-secondary-full"
                                style={{ marginTop: '1rem', background: '#f8fafc', border: '1px solid var(--border)' }}
                                onClick={handleResendConfirmation}
                                disabled={authLoading}
                            >
                                <Mail size={16} /> Reenviar Email de Confirmación
                            </button>
                        )}
                    </form>

                    <div className="auth-footer">
                        {authMode === 'login' ? (
                            <p>¿No tienes cuenta? <button onClick={() => setAuthMode('signup')}>Regístrate</button></p>
                        ) : (
                            <p>¿Ya tienes cuenta? <button onClick={() => setAuthMode('login')}>Inicia Sesión</button></p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (isStudentMode) {
        const currentStudent = students.find(s => s.registrationToken === registrationToken) || { name: 'Alumno' };

        // Filter notifications for this specific student or 'Todos'
        const studentNotifications = notifications.filter(n =>
            n.target === 'Todos' ||
            n.target === 'Activos' ||
            n.target === currentStudent.id
        );

        return (
            <div className="student-app-container">
                <header className="student-header">
                    <h1>{userWorkspace?.name || 'Gestión Flex'}</h1>
                    <span className="welcome-msg">Hola, {currentStudent.name.split(' ')[0]}</span>
                </header>

                <main className="student-main">
                    {studentStep === 1 ? (
                        <div className="registration-card animate-fade-in">
                            <h2>Completa tus datos</h2>
                            <p className="step-desc">Necesitamos estos datos para tu ficha médica y administrativa.</p>

                            <div className="ocr-section">
                                <button className="btn-ocr" onClick={() => { setIsStudentMode(true); setShowCamera(true); }}>
                                    <Camera size={20} /> {studentData.dniUrl ? 'Recapturar DNI' : 'Escanear DNI'}
                                </button>
                                <span>o completa manualmente</span>
                            </div>

                            {/* DNI Photo Preview */}
                            {capturedDniPreview && (
                                <div style={{ margin: '0.75rem 0', borderRadius: '10px', overflow: 'hidden', border: '2px solid #6366f1', position: 'relative' }}>
                                    <img
                                        src={capturedDniPreview}
                                        alt="Foto DNI"
                                        style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', display: 'block' }}
                                    />
                                    <div style={{ position: 'absolute', top: '6px', right: '6px', display: 'flex', gap: '6px' }}>
                                        <span style={{ background: '#22c55e', color: '#fff', borderRadius: '6px', padding: '2px 8px', fontSize: '0.75rem', fontWeight: '700' }}>✓ DNI guardado</span>
                                        <button
                                            onClick={() => { setCapturedDniPreview(''); setStudentData(prev => ({ ...prev, dniUrl: '' })); }}
                                            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', padding: '2px 8px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                                        >✕ Eliminar</button>
                                    </div>
                                </div>
                            )}

                            <div className="student-form">
                                <div className="form-group">
                                    <label>Nombre Completo</label>
                                    <input
                                        type="text"
                                        value={studentData.name}
                                        onChange={e => setStudentData({ ...studentData, name: e.target.value })}
                                        placeholder={currentStudent.name !== 'Nuevo Alumno' ? currentStudent.name : "Tu nombre y apellido"}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>DNI</label>
                                    <input type="text" value={studentData.dni} onChange={e => setStudentData({ ...studentData, dni: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label>Fecha de Nacimiento</label>
                                    <input type="date" value={studentData.birthDate} onChange={e => setStudentData({ ...studentData, birthDate: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label>Dirección</label>
                                    <input type="text" value={studentData.address} onChange={e => setStudentData({ ...studentData, address: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label>Apto Físico (Foto o PDF)</label>
                                    <div className="file-upload-group">
                                        <input
                                            type="file"
                                            accept="image/*,application/pdf"
                                            onChange={e => handleFileUploadToStorage(e.target.files[0], 'apto')}
                                            id="apto-upload"
                                            className="hidden-input"
                                        />
                                        <label htmlFor="apto-upload" className="btn-secondary-mini">
                                            {studentData.physicalAptitudeUrl ? <Check size={16} /> : <Plus size={16} />}
                                            {studentData.physicalAptitudeUrl ? ' Cambiar Archivo' : ' Subir Archivo'}
                                        </label>
                                    </div>
                                    {studentData.physicalAptitudeUrl && <span className="file-success">Archivo listo</span>}
                                </div>
                                <button className="btn-confirm-full" onClick={() => setStudentStep(2)}>Siguiente</button>
                            </div>
                        </div>
                    ) : studentStep === 2 ? (
                        <div className="registration-card animate-fade-in">
                            <h2>Disciplina y Horario</h2>
                            <p className="step-desc">Selecciona tu actividad principal.</p>

                            <div className="student-form">
                                <div className="form-group">
                                    <label>Disciplina</label>
                                    <select value={studentData.disciplina} onChange={e => setStudentData({ ...studentData, disciplina: e.target.value })}>
                                        <option value="">Selecciona...</option>
                                        <option value="Pilates Reformer">Pilates Reformer</option>
                                        <option value="Yoga">Yoga</option>
                                        <option value="Funcional">Funcional</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Horario Preferido</label>
                                    <select value={studentData.horario} onChange={e => setStudentData({ ...studentData, horario: e.target.value })}>
                                        <option value="">Selecciona...</option>
                                        <option value="Mañana (8:00 - 12:00)">Mañana (8:00 - 12:00)</option>
                                        <option value="Tarde (14:00 - 18:00)">Tarde (14:00 - 18:00)</option>
                                        <option value="Noche (18:00 - 21:00)">Noche (18:00 - 21:00)</option>
                                    </select>
                                </div>
                                <div className="btn-group-row">
                                    <button className="btn-cancel" onClick={() => setStudentStep(1)}>Atrás</button>
                                    <button className="btn-confirm" onClick={finishStudentRegistration}>Finalizar Registro</button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="student-dashboard animate-fade-in">
                            <h2>Mi Dashboard</h2>

                            <div className="student-status-grid">
                                <div className="status-card">
                                    <div className="status-icon paid"><FileCheck size={24} /></div>
                                    <div className="status-info">
                                        <span className="label">Estado de Inscripción</span>
                                        <span className="value">Activo</span>
                                    </div>
                                </div>
                                <div className="status-card">
                                    <div className={`status-icon ${hasPaidCurrentMonth(currentStudent) ? 'paid' : 'pending'}`}>
                                        <DollarSign size={24} />
                                    </div>
                                    <div className="status-info">
                                        <span className="label">Cuota Mensual</span>
                                        <span className="value">{hasPaidCurrentMonth(currentStudent) ? 'Al día' : 'Pendiente'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="upcoming-section" style={{ marginTop: '1.5rem' }}>
                                <h3>📅 Mi Horario</h3>
                                <div className="schedule-card">
                                    {currentStudent.disciplina ? (
                                        <div className="schedule-details">
                                            <div className="schedule-row">
                                                <span className="schedule-label">Disciplina</span>
                                                <span className="schedule-value">{currentStudent.disciplina}</span>
                                            </div>
                                            <div className="schedule-row">
                                                <span className="schedule-label">Horario</span>
                                                <span className="schedule-value">{currentStudent.horario || 'Sin asignar'}</span>
                                            </div>
                                            <div className="schedule-row">
                                                <span className="schedule-label">Clases por semana</span>
                                                <span className="schedule-value">{currentStudent.classesPerWeek || '-'}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="no-data">Tu horario aún no ha sido asignado.</p>
                                    )}
                                </div>
                            </div>

                            <div className="upcoming-section" style={{ marginTop: '1.5rem' }}>
                                <h3>🔔 Notificaciones</h3>
                                <div className="notifications-list">
                                    {notifications.length > 0 ? (
                                        notifications
                                            .filter(n => n.target === 'Todos' || n.target === 'Activos')
                                            .map(n => (
                                                <div key={n.id} className="notification-item">
                                                    <div className="ni-header">
                                                        <span className={`n-type ${n.type.toLowerCase().replace(/ /g, '-')}`}>{n.type}</span>
                                                        <span className="ni-date">{new Date(n.date).toLocaleDateString()}</span>
                                                    </div>
                                                    <h4>{n.title}</h4>
                                                    <p>{n.message}</p>
                                                </div>
                                            ))
                                    ) : (
                                        <p className="no-data">No tienes notificaciones pendientes.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </main>

                {/* GLOBAL CAMERA OVERLAY for student mode */}
                {showCamera && (
                    <div style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.92)',
                        zIndex: 99999,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '1rem',
                        padding: '1rem'
                    }}>
                        <p style={{ color: '#a5b4fc', fontWeight: '600', fontSize: '1rem', marginBottom: '0.25rem' }}>
                            📷 Coloca el DNI frente a la cámara
                        </p>
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            style={{
                                width: '100%',
                                maxWidth: '480px',
                                borderRadius: '12px',
                                border: '2px solid #6366f1',
                                background: '#000'
                            }}
                        />
                        {ocrLoading ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                <div className="ocr-spinner" />
                                <span style={{ color: '#fff', fontSize: '0.9rem' }}>Analizando DNI con OCR...</span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                <button
                                    style={{
                                        background: '#6366f1', color: '#fff', border: 'none',
                                        borderRadius: '8px', padding: '0.75rem 2rem',
                                        fontSize: '1rem', fontWeight: '600', cursor: 'pointer'
                                    }}
                                    onClick={handleCameraCapture}
                                >
                                    📸 Capturar DNI
                                </button>
                                <button
                                    style={{
                                        background: 'transparent', color: '#94a3b8',
                                        border: '1px solid #334155', borderRadius: '8px',
                                        padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer'
                                    }}
                                    onClick={() => setShowCamera(false)}
                                >
                                    Cancelar
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    const filteredStudents = students.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        s.id !== "0" &&
        (statusFilter === 'todos' || s.status === statusFilter || (!s.status && statusFilter === 'activo')) &&
        !s.name.toUpperCase().includes("GASTO") &&
        !s.id.toUpperCase().includes("GASTO")
    );
    return (
        <div className="app-container">
            <aside className="sidebar">
                <div className="logo-section">
                    <h1>{userWorkspace?.name || 'Gestión Flex'}</h1>
                    <span className="beta-label">Gestión inteligente de {getLabel().toLowerCase()}</span>
                </div>
                <nav className="nav-menu">
                    <div className="nav-group">
                        <button
                            className={`nav-item ${currentView === 'alumnos' ? 'active' : ''}`}
                            onClick={() => { setCurrentView('alumnos'); setSelectedStudent(null); }}
                        >
                            <User size={22} /> <span>{getLabel()}</span>
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
                        <button
                            className={`nav-item ${currentView === 'notificaciones' ? 'active' : ''}`}
                            onClick={() => { setCurrentView('notificaciones'); setSelectedStudent(null); }}
                        >
                            <Bell size={22} /> <span>Notificaciones</span>
                        </button>
                    </div>

                    <div className="nav-group logout-group">
                        <button className="nav-item btn-logout" onClick={handleLogout}>
                            <LogOut size={22} /> <span>Cerrar Sesión</span>
                        </button>
                    </div>

                </nav>
            </aside>

            <main className="main-content">
                <header className="main-header">
                    {selectedStudent ? (
                        <button className="btn-back" onClick={() => { setSelectedStudent(null); setSearchTerm(''); }}>
                            <ChevronLeft size={20} /> Volver al listado
                        </button>
                    ) : currentView === 'alumnos' ? (
                        <div className="search-filter-group">
                            <div className="search-bar">
                                <Search size={18} className="search-icon" />
                                <input
                                    type="text"
                                    placeholder={`Buscar ${getLabel(true).toLowerCase()}...`}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <div className="filter-group">
                                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                                    <option value="todos">Todos los Estados</option>
                                    <option value="activo">Activos</option>
                                    <option value="pendiente">Pendientes</option>
                                    <option value="inactivo">Inactivos</option>
                                </select>
                            </div>
                        </div>
                    ) : (
                        <h2>{currentView === 'reportes' ? 'Reportes de Gestión' : currentView === 'notificaciones' ? 'Centro de Notificaciones' : 'Ajustes de Sistema'}</h2>
                    )}

                    {currentView === 'alumnos' && !selectedStudent && (
                        <div className="header-actions">
                            <button className="btn-secondary" onClick={() => setShowPhoneAddModal(true)}><Plus size={18} /> Por número</button>
                            <button className="btn-add" onClick={() => setShowAddModal(true)}><Plus size={18} /> Nuevo {getLabel(true)}</button>
                        </div>
                    )}

                    {selectedStudent && (
                        <div className="header-actions">
                            <button className="btn-secondary" onClick={() => exportStudentPDF(selectedStudent)} title={`Exportar Ficha ${getLabel(true)} PDF`}>
                                <FileText size={18} />
                            </button>
                            <button className="btn-secondary" onClick={() => showToast('Módulo de Ficha Médica en desarrollo', 'error')}>
                                <span>Ficha Médica</span>
                            </button>
                            <button className="btn-save" onClick={saveStudentChanges}><Save size={18} /> Guardar</button>
                        </div>
                    )}
                </header>

                <section className="dashboard">
                    {selectedStudent ? (
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
                                            <label>DNI:</label>
                                            <input
                                                type="text"
                                                value={selectedStudent.dni || ''}
                                                onChange={(e) => updateStudentField('dni', e.target.value)}
                                                placeholder="DNI alumno..."
                                            />
                                        </div>
                                        {selectedStudent.physicalAptitudeUrl && (
                                            <a href={selectedStudent.physicalAptitudeUrl} target="_blank" rel="noreferrer" className="badge-link">
                                                <FileText size={14} /> Apto Físico
                                            </a>
                                        )}
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
                    ) : currentView === 'alumnos' ? (
                        <div className="student-list-container">
                            <div className="list-header">
                                <h3>Listado de Alumnos ({filteredStudents.length})</h3>
                                <div className="list-actions">
                                    {isLoaded && <button className="btn-secondary" onClick={() => exportToExcel('alumnos')}>Exportar Excel</button>}
                                </div>
                            </div>

                            <div className="student-grid">
                                {students.length > 0 || isLoaded ? (
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
                                            <h3>Bienvenido a {userWorkspace?.name || 'Gestión Flex'}</h3>
                                            <p>Aún no hay datos cargados en esta computadora.</p>
                                            <button
                                                className="btn-add"
                                                onClick={() => fileInputRef.current.click()}
                                                style={{ marginTop: '1.5rem', marginInline: 'auto' }}
                                            >
                                                <FileText size={18} /> Importar planilla
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : currentView === 'reportes' ? (
                        <div className="reports-container">
                            <div className="report-card main-summary">
                                <div className="report-header">
                                    <div className="report-title-group">
                                        <h3>Resumen de Gestión General</h3>
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
                                        <div className="stat-value">{totals.totalMoney > 0 ? `$ ${totals.totalMoney.toLocaleString()}` : '---'}</div>
                                        <div className="stat-delta">{totals.activeStudents} cuotas cobradas</div>
                                    </div>
                                    <div className="report-stat-card danger">
                                        <div className="stat-label">Gastos Totales</div>
                                        <div className="stat-value">{totals.totalExpenses > 0 ? `$ ${totals.totalExpenses.toLocaleString()}` : '---'}</div>
                                        <div className="stat-delta">Costos de este mes</div>
                                    </div>
                                    <div className="report-stat-card success">
                                        <div className="stat-label">Ganancia Neta</div>
                                        <div className="stat-value">{totals.netProfit !== 0 ? `$ ${totals.netProfit.toLocaleString()}` : '---'}</div>
                                        <div className="stat-delta">Ingresos - Gastos</div>
                                    </div>
                                </div>
                            </div>

                            <div className="report-card honorarios-section">
                                <div className="section-header">
                                    <h3>Honorarios y Horas</h3>
                                    <span>{new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</span>
                                </div>
                                <div className="salary-grid">
                                    {personnelList.map(person => {
                                        const data = salaryData.find(s => s.personId === person.id) || { hours: 0, hourlyValue: 0, advances: 0 };
                                        const sueldo = data.hours * data.hourlyValue;
                                        const resto = sueldo - data.advances;
                                        return (
                                            <div key={person.id} className={`salary-card`}>
                                                <div className="card-header">
                                                    <h4>{person.name.toUpperCase()}</h4>
                                                </div>
                                                <div className="salary-inputs">
                                                    <div className="input-group">
                                                        <label>Horas Trabajadas</label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={data.hours || ''}
                                                            onChange={e => {
                                                                const val = e.target.value.replace(',', '.');
                                                                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                                    updateSalary(person.id, 'hours', parseFloat(val) || 0);
                                                                }
                                                            }}
                                                            placeholder="0 hs"
                                                        />
                                                    </div>
                                                    <div className="input-group">
                                                        <label>Valor Hora</label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={data.hourlyValue || ''}
                                                            onChange={e => {
                                                                const val = e.target.value.replace(',', '.');
                                                                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                                    updateSalary(person.id, 'hourlyValue', parseFloat(val) || 0);
                                                                }
                                                            }}
                                                            placeholder="$ 0"
                                                        />
                                                    </div>
                                                    <div className="input-group">
                                                        <label>Adelantos</label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={data.advances || ''}
                                                            onChange={e => {
                                                                const val = e.target.value.replace(',', '.');
                                                                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                                    updateSalary(person.id, 'advances', parseFloat(val) || 0);
                                                                }
                                                            }}
                                                            placeholder="$ 0"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="salary-results">
                                                    <div className="result-row">
                                                        <span>Sueldo Bruto</span>
                                                        <strong>{sueldo > 0 ? `$ ${sueldo.toLocaleString()}` : '---'}</strong>
                                                    </div>
                                                    <div className="result-row highlight">
                                                        <span>Resto a pagar</span>
                                                        <strong>{resto !== 0 ? `$ ${resto.toLocaleString()}` : '---'}</strong>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <button className="btn-confirm-full" onClick={saveSalaries} style={{ marginTop: '1.5rem' }}>
                                    <Save size={18} /> Guardar todos los sueldos
                                </button>
                            </div>

                            {/* Gastos Section */}
                            <div className="report-card">
                                <div className="section-header">
                                    <h3>Gestión de Gastos (Gastos Operativos)</h3>
                                    <p className="report-subtitle">Registra aquí los egresos del mes</p>
                                </div>

                                <div className="expense-summary-mini">
                                    <div className="summary-item">
                                        <span>Manuales:</span>
                                        <span className="value">{expensesData.length > 0 ? `$ ${expensesData.reduce((acc, exp) => acc + (parseFloat(exp.amount) || 0), 0).toLocaleString()}` : '---'}</span>
                                    </div>
                                    <div className="summary-item highlight">
                                        <span>De Planilla:</span>
                                        <span className="value">{fileExpenses.length > 0 ? `$ ${fileExpenses.reduce((acc, exp) => {
                                            const latest = exp.history[exp.history.length - 1];
                                            return acc + (latest ? cleanMoneyString(latest.amount) : 0);
                                        }, 0).toLocaleString()}` : '---'}</span>
                                    </div>
                                    <div className="summary-item total">
                                        <span>TOTAL:</span>
                                        <span className="value">{totals.totalExpenses > 0 ? `$ ${totals.totalExpenses.toLocaleString()}` : '---'}</span>
                                    </div>
                                </div>

                                <div className="expense-form">
                                    <input
                                        type="text"
                                        placeholder="Descripción del gasto..."
                                        value={newExpense.description}
                                        onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                                    />
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Monto"
                                        value={newExpense.amount || ''}
                                        onChange={e => {
                                            const val = e.target.value.replace(',', '.');
                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                setNewExpense({ ...newExpense, amount: val });
                                            }
                                        }}
                                    />
                                    <button className="btn-add" onClick={addExpense}>
                                        <Plus size={18} /> Agregar
                                    </button>
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
                                                                        value={editExpenseData.amount || ''}
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
                                                                    <button className="btn-icon-danger" onClick={() => deleteExpense(exp.id)}>
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
                                            {personnelList.map(p => {
                                                const d = salaryData.find(sd => sd.personId === p.id) || { hours: 0, hourlyValue: 0, advances: 0 };
                                                const sueldo = d.hours * d.hourlyValue;
                                                return (
                                                    <tr key={p.id}>
                                                        <td data-label="Personal"><strong>{p.name.toUpperCase()}</strong></td>
                                                        <td data-label="Horas">
                                                            <input
                                                                type="number"
                                                                className="edit-input-mini"
                                                                value={d.hours}
                                                                onChange={e => updateSalary(p.id, 'hours', parseFloat(e.target.value) || 0)}
                                                            />
                                                        </td>
                                                        <td data-label="Valor Hora">
                                                            <input
                                                                type="number"
                                                                className="edit-input-mini"
                                                                value={d.hourlyValue}
                                                                onChange={e => updateSalary(p.id, 'hourlyValue', parseFloat(e.target.value) || 0)}
                                                            />
                                                        </td>
                                                        <td data-label="Sueldo Bruto">$ {sueldo.toLocaleString()}</td>
                                                        <td data-label="Adelanto">
                                                            <input
                                                                type="number"
                                                                className="edit-input-mini"
                                                                value={d.advances}
                                                                onChange={e => updateSalary(p.id, 'advances', parseFloat(e.target.value) || 0)}
                                                            />
                                                        </td>
                                                        <td data-label="Resto a Pagar" className="amount-highlight">$ {(sueldo - d.advances).toLocaleString()}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <button className="btn-add" style={{ marginTop: '1rem' }} onClick={saveSalaries}>
                                    <Save size={18} /> Guardar Sueldos
                                </button>
                            </div>

                            <div className="report-card honorarios-summary">
                                <h3>Resumen Mensual de egresos (Planilla + Manuales) - {new Date().toLocaleDateString('es-ES', { month: 'long' }).toUpperCase()} {new Date().getFullYear()}</h3>
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
                                                    <td data-label="Concepto"><strong>{exp.description}</strong></td>
                                                    <td data-label="Monto" className="amount-highlight">$ {parseFloat(exp.amount).toLocaleString()}</td>
                                                    <td data-label="Origen/Recibió">Carga Manual</td>
                                                    <td data-label="Fecha">{new Date().toLocaleDateString('es-ES')}</td>
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

                                            {/* Honorarios rows in Detailed Table */}
                                            {personnelList.map(p => {
                                                const d = salaryData.find(sd => sd.personId === p.id) || { hours: 0, hourlyValue: 0, advances: 0 };
                                                const sueldo = d.hours * d.hourlyValue;
                                                if (sueldo <= 0) return null;
                                                return (
                                                    <tr key={`salary-row-${p.id}`} className="honorario-row-subtle">
                                                        <td data-label="Concepto"><strong>Honorarios {p.name.toUpperCase()}</strong></td>
                                                        <td data-label="Monto" className="amount-highlight">$ {sueldo.toLocaleString()}</td>
                                                        <td data-label="Origen/Recibió">Cálculo Auto</td>
                                                        <td data-label="Fecha">{new Date().toLocaleDateString('es-ES')}</td>
                                                    </tr>
                                                );
                                            })}

                                            {/* Total Row */}
                                            <tr className="total-row">
                                                <td><strong>TOTAL EGRESOS (Gastos + Honorarios)</strong></td>
                                                <td colSpan="3"><strong>$ {(totals.totalExpenses + totals.totalHonorarios).toLocaleString()}</strong></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : currentView === 'notificaciones' ? (
                        <div className="notifications-admin-container">
                            <header className="section-header">
                                <h2>Centro de Notificaciones</h2>
                                <p className="report-subtitle">Envía mensajes y avisos a tus alumnos</p>
                            </header>

                            <div className="report-card">
                                <h3>Nueva Notificación</h3>
                                <div className="notification-form">
                                    <div className="form-group">
                                        <label>Título</label>
                                        <input
                                            type="text"
                                            value={newNotification.title}
                                            onChange={e => setNewNotification({ ...newNotification, title: e.target.value })}
                                            placeholder="Ej: Feriado de Carnaval"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Mensaje</label>
                                        <textarea
                                            value={newNotification.message}
                                            onChange={e => setNewNotification({ ...newNotification, message: e.target.value })}
                                            placeholder="Escribe el mensaje aquí..."
                                        />
                                    </div>
                                    <div className="form-group-row">
                                        <div className="form-group">
                                            <label>Tipo</label>
                                            <select
                                                value={newNotification.type}
                                                onChange={e => setNewNotification({ ...newNotification, type: e.target.value })}
                                            >
                                                <option value="General">General</option>
                                                <option value="Feriado">Feriado</option>
                                                <option value="Cancelación">Cancelación</option>
                                                <option value="Evento">Evento</option>
                                                <option value="Cumpleaños">Cumpleaños</option>
                                                <option value="Vencimiento de cuota">Vencimiento de cuota</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Destinatarios</label>
                                            <select
                                                value={newNotification.target}
                                                onChange={e => setNewNotification({ ...newNotification, target: e.target.value })}
                                            >
                                                <option value="Todos">Todos los alumnos</option>
                                                <option value="Activos">Solo Activos</option>
                                                <option value="Pendientes">Solo Pendientes</option>
                                            </select>
                                        </div>
                                    </div>
                                    <button className="btn-add" style={{ marginTop: '1rem' }} onClick={sendNotification}>
                                        <Plus size={18} /> Enviar Notificación
                                    </button>
                                </div>
                            </div>

                            <div className="report-card">
                                <h3>Historial de Envíos</h3>
                                <div className="notifications-list">
                                    {notifications.length > 0 ? (
                                        <div className="notification-history-grid">
                                            {notifications.map(n => (
                                                <div key={n.id} className="notification-history-item">
                                                    <div className="n-header">
                                                        <span className={`n-type ${n.type.toLowerCase().replace(/ /g, '-')}`}>{n.type}</span>
                                                        <span className="n-date">{new Date(n.date).toLocaleDateString()}</span>
                                                    </div>
                                                    <h4>{n.title}</h4>
                                                    <p>{n.message}</p>
                                                    <div className="n-footer">
                                                        <span>Destino: {n.target}</span>
                                                        <div className="n-actions">
                                                            <a
                                                                href={`https://wa.me/?text=${encodeURIComponent('*' + n.title + '*\n\n' + n.message)}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="btn-icon-whatsapp"
                                                                title="Compartir por WhatsApp"
                                                            >
                                                                <MessageCircle size={16} />
                                                            </a>
                                                            <button className="btn-icon-danger" onClick={() => deleteNotification(n.id)}>
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="no-data">No hay notificaciones enviadas.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="settings-container">
                            <h2>Ajustes de Sistema</h2>
                            <p className="report-subtitle">Configuración de tu espacio de trabajo colaborativo.</p>

                            <div className="report-card" style={{ marginTop: '1.5rem' }}>
                                <h3>Información del Espacio y Perfil</h3>
                                <p className="report-subtitle">Personaliza cómo te ves y cómo se llama tu negocio.</p>
                                <div className="form-group">
                                    <label>Nombre del Espacio (Estudio/Gimnasio)</label>
                                    <div className="input-with-button">
                                        <input
                                            type="text"
                                            value={editWorkspaceName}
                                            onChange={e => setEditWorkspaceName(e.target.value)}
                                            placeholder="Ej: VN Pilates"
                                        />
                                        <button className="btn-save-mini" onClick={saveWorkspaceBranding}>
                                            <Save size={16} /> Guardar
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group" style={{ marginTop: '1rem' }}>
                                    <label>Modo de Terminología</label>
                                    <p className="report-subtitle">Cambia cómo se refieren a tus clientes en la app.</p>
                                    <div className="btn-group-row" style={{ marginTop: '0.5rem' }}>
                                        <button
                                            className={`btn-toggle ${clientType === 'alumnos' ? 'active' : ''}`}
                                            onClick={async () => {
                                                setClientType('alumnos');
                                                await supabase.from('workspaces').update({ client_type: 'alumnos' }).eq('id', userWorkspace.id);
                                            }}
                                        >
                                            Alumnos
                                        </button>
                                        <button
                                            className={`btn-toggle ${clientType === 'pacientes' ? 'active' : ''}`}
                                            onClick={async () => {
                                                setClientType('pacientes');
                                                await supabase.from('workspaces').update({ client_type: 'pacientes' }).eq('id', userWorkspace.id);
                                            }}
                                        >
                                            Pacientes
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group" style={{ marginTop: '1rem' }}>
                                    <label>Tu Nombre (Administrador)</label>
                                    <div className="input-with-button">
                                        <input
                                            type="text"
                                            value={editAdminName}
                                            onChange={e => setEditAdminName(e.target.value)}
                                            placeholder="Tu nombre completo"
                                        />
                                        <button className="btn-save-mini" onClick={saveAdminName}>
                                            <Save size={16} /> Guardar
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="report-card" style={{ marginTop: '1.5rem' }}>
                                <h3>Gestionar Personal / Profesores / Profesional</h3>
                                <p className="report-subtitle">Agrega o elimina personal para el registro de pagos y sueldos.</p>
                                <div className="admin-invite-form">
                                    <input
                                        type="text"
                                        placeholder="Nombre del profesor / profesional"
                                        value={newPersonName}
                                        onChange={e => setNewPersonName(e.target.value)}
                                    />
                                    <button className="btn-add" onClick={() => addPerson(newPersonName)}>
                                        <Plus size={18} /> Agregar
                                    </button>
                                </div>
                                <div className="admins-list">
                                    {personnelList.map(p => (
                                        <div key={p.id} className="admin-item">
                                            <div className="admin-info">
                                                <User size={16} />
                                                <span>{p.name}</span>
                                            </div>
                                            <button className="btn-icon-danger" onClick={() => removePerson(p.id)}>
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="report-card" style={{ marginTop: '1.5rem' }}>
                                <h3>Gestionar Administradores</h3>
                                <p className="report-subtitle">Invita a otros administradores para gestionar este workspace.</p>

                                <div className="admin-invite-form">
                                    <input
                                        type="email"
                                        placeholder="Email del nuevo administrador"
                                        value={inviteEmail}
                                        onChange={e => setInviteEmail(e.target.value)}
                                    />
                                    <button className="btn-add" onClick={() => inviteAdmin(inviteEmail)}>
                                        <Plus size={18} /> Invitar
                                    </button>
                                </div>

                                <div className="admins-list">
                                    <h4>Miembros Activos</h4>
                                    {workspaceAdmins.members?.map(m => (
                                        <div key={m.id} className="admin-item">
                                            <div className="admin-info">
                                                <User size={16} />
                                                <span>{m.profiles?.full_name || 'Usuario registrado'} ({m.role})</span>
                                                {m.user_id === session.user.id && <span className="you-tag">Tú</span>}
                                            </div>
                                        </div>
                                    ))}

                                    {workspaceAdmins.invites?.length > 0 && (
                                        <>
                                            <h4 style={{ marginTop: '1rem' }}>Invitaciones Pendientes</h4>
                                            {workspaceAdmins.invites.map(i => (
                                                <div key={i.id} className="admin-item pending">
                                                    <div className="admin-info">
                                                        <Mail size={16} />
                                                        <span>{i.email} (En espera de registro)</span>
                                                    </div>
                                                    <button className="btn-icon-danger" onClick={async () => {
                                                        await supabase.from('workspace_invites').delete().eq('id', i.id);
                                                        fetchWorkspaceAdmins();
                                                    }}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="report-card" style={{ marginTop: '1.5rem' }}>
                                <h3>Importación de Datos</h3>
                                <p className="report-subtitle">Sincroniza tus datos locales con la planilla central.</p>
                                <div className="list-actions" style={{ marginTop: '1rem', flexDirection: 'column', gap: '0.75rem' }}>
                                    <button className="btn-secondary" style={{ width: '100%' }} onClick={() => fileInputRef.current.click()}>
                                        <Save size={20} /> <span style={{ marginLeft: '0.5rem' }}>Importar CSV Local</span>
                                    </button>
                                </div>
                            </div>

                            <div className="danger-zone" style={{ marginTop: '2rem' }}>
                                <h3>⚠️ Zona Peligrosa</h3>
                                <p>Las siguientes acciones son irreversibles. Procede con precaución.</p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
                                    <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '1rem' }}>
                                        <p style={{ fontWeight: '600', marginBottom: '0.4rem' }}>Borrar toda la base de datos</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Elimina todos los alumnos, pagos, notificaciones y gastos. Tu cuenta seguirá activa.</p>
                                        <button className="btn-danger" onClick={handleResetDatabase}>
                                            Borrar Base de Datos
                                        </button>
                                    </div>
                                    <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '1rem' }}>
                                        <p style={{ fontWeight: '600', marginBottom: '0.4rem' }}>Eliminar cuenta de administrador</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Elimina todos los datos y cierra tu cuenta de forma permanente. Deberás escribir ELIMINAR para confirmar.</p>
                                        <button className="btn-danger" onClick={handleDeleteAdmin}>
                                            Eliminar Cuenta y Datos
                                        </button>
                                    </div>
                                    <div style={{ background: 'rgba(100,100,100,0.07)', border: '1px solid rgba(100,100,100,0.2)', borderRadius: '8px', padding: '1rem' }}>
                                        <p style={{ fontWeight: '600', marginBottom: '0.4rem' }}>Cerrar Sesión</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Cierra la sesión actual. Los datos en la nube permanecerán seguros.</p>
                                        <button className="btn-secondary" onClick={handleLogout}>
                                            Cerrar Sesión
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </main>

            {
                showPhoneAddModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Agregar por Número</h3>
                            <p className="modal-subtitle">Se enviará un link para que el {getLabel(true).toLowerCase()} complete sus datos.</p>

                            {!generatedLink ? (
                                <>
                                    <div className="form-group">
                                        <label>Número de Teléfono</label>
                                        <input
                                            type="tel"
                                            value={phoneToAdd}
                                            onChange={e => setPhoneToAdd(e.target.value.replace(/\D/g, ''))}
                                            placeholder="Ej: 1122334455"
                                        />
                                    </div>
                                    <div className="modal-footer">
                                        <button className="btn-cancel" onClick={() => { setShowPhoneAddModal(false); setPhoneToAdd(''); }}>Cancelar</button>
                                        <button className="btn-confirm" onClick={() => generateRegistrationLink(phoneToAdd)}>Generar Link</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="generated-link-box">
                                        <label>Link de inscripción:</label>
                                        <div className="copy-link-group">
                                            <input type="text" readOnly value={generatedLink} />
                                            <button className="btn-secondary" onClick={() => {
                                                navigator.clipboard.writeText(generatedLink);
                                                showToast("Copiado al portapapeles");
                                            }}><Check size={16} /></button>
                                        </div>
                                        <a
                                            href={`https://wa.me/${phoneToAdd}?text=${encodeURIComponent('Hola! Te comparto el link para que te registres en Gestión Flex: ' + generatedLink)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="whatsapp-send-btn"
                                        >
                                            <MessageCircle size={18} /> Enviar por WhatsApp
                                        </a>
                                    </div>
                                    <div className="modal-footer">
                                        <button className="btn-confirm" onClick={() => {
                                            setShowPhoneAddModal(false);
                                            setPhoneToAdd('');
                                            setGeneratedLink('');
                                        }}>Finalizar</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )
            }

            {
                showAddModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Nuevo {getLabel(true)}</h3>

                            <div className="ocr-section-compact" style={{ marginBottom: '1rem', textAlign: 'center' }}>
                                <button className="btn-ocr" onClick={() => { setIsStudentMode(false); setShowCamera(true); }}>
                                    <Camera size={20} /> {newStudent.dniUrl ? 'Recapturar DNI' : 'Smart DNI Scan'}
                                </button>
                                <p className="help-text-xs">Escanea el DNI para autocompletar datos</p>
                            </div>

                            {/* DNI Photo Preview in admin modal */}
                            {capturedDniPreview && (
                                <div style={{ margin: '0 0 1rem 0', borderRadius: '10px', overflow: 'hidden', border: '2px solid #6366f1', position: 'relative' }}>
                                    <img
                                        src={capturedDniPreview}
                                        alt="Foto DNI"
                                        style={{ width: '100%', maxHeight: '150px', objectFit: 'cover', display: 'block' }}
                                    />
                                    <div style={{ position: 'absolute', top: '6px', right: '6px', display: 'flex', gap: '6px' }}>
                                        <span style={{ background: '#22c55e', color: '#fff', borderRadius: '6px', padding: '2px 8px', fontSize: '0.75rem', fontWeight: '700' }}>✓ DNI guardado</span>
                                        <button
                                            onClick={() => { setCapturedDniPreview(''); setNewStudent(prev => ({ ...prev, dniUrl: '' })); }}
                                            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', padding: '2px 8px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                                        >✕ Eliminar</button>
                                    </div>
                                </div>
                            )}

                            <div className="form-group">
                                <label>Nombre Completo</label>
                                <input type="text" value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} placeholder="Nombre y Apellido" />
                            </div>
                            <div className="form-group-row">
                                <div className="form-group">
                                    <label>Clases por semana</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={newStudent.classesPerWeek}
                                        onChange={e => {
                                            const val = e.target.value.replace(/\D/g, '');
                                            setNewStudent({ ...newStudent, classesPerWeek: val });
                                        }}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Fecha de Ingreso</label>
                                    <input
                                        type="text"
                                        placeholder="Ej: 21/02/2024"
                                        value={newStudent.entryDate}
                                        onChange={e => setNewStudent({ ...newStudent, entryDate: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Teléfono (Opcional)</label>
                                <input
                                    type="tel"
                                    value={newStudent.phone}
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (val === '' || /^[0-9+\-(){}\s]*$/.test(val)) {
                                            setNewStudent({ ...newStudent, phone: val });
                                        }
                                    }}
                                    placeholder="Ej: 1122334455"
                                />
                            </div>

                            <div className="form-group-row">
                                <div className="form-group">
                                    <label>DNI</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={newStudent.dni || ''}
                                        onChange={e => setNewStudent({ ...newStudent, dni: e.target.value.replace(/\D/g, '') })}
                                        placeholder="Número de DNI"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Fecha de Nacimiento</label>
                                    <input
                                        type="date"
                                        value={newStudent.birthDate || ''}
                                        onChange={e => setNewStudent({ ...newStudent, birthDate: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="form-divider">Primer Pago (Opcional)</div>

                            <div className="form-group-row">
                                <div className="form-group">
                                    <label>Monto Recibido</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newStudent.initialAmount || ''}
                                        onChange={e => {
                                            const val = e.target.value.replace(',', '.');
                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                setNewStudent({ ...newStudent, initialAmount: val });
                                            }
                                        }}
                                        placeholder="Monto"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Recibió</label>
                                    <select value={newStudent.initialReceiver} onChange={e => setNewStudent({ ...newStudent, initialReceiver: e.target.value })}>
                                        <option value="">Seleccionar quien recibió</option>
                                        {personnelList.map(p => (
                                            <option key={p.id} value={p.name}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowAddModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={addStudent}>Agregar Alumno</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showPaymentModal && (
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
                                        type="text"
                                        inputMode="decimal"
                                        value={newPayment.amount || ''}
                                        onChange={e => {
                                            const val = e.target.value.replace(',', '.');
                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                setNewPayment({ ...newPayment, amount: val });
                                            }
                                        }}
                                        placeholder="Monto"
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Recibió</label>
                                <select
                                    value={newPayment.receivedBy}
                                    onChange={e => setNewPayment({ ...newPayment, receivedBy: e.target.value })}
                                >
                                    <option value="">Seleccionar quien recibió</option>
                                    {personnelList.map(p => (
                                        <option key={p.id} value={p.name}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-footer">
                                <button className="btn-cancel" onClick={() => setShowPaymentModal(false)}>Cancelar</button>
                                <button className="btn-confirm" onClick={confirmPayment}>Registrar Pago</button>
                            </div>
                        </div>
                    </div>
                )
            }
            {
                showLinkModal && (
                    <div className="modal-overlay">
                        <div className="modal-card">
                            <h3>Importar desde Link</h3>
                            <div className="modal-help-box">
                                <p>Para que funcione, sigue estos 2 pasos en tu planilla:</p>
                                <ol className="help-steps">
                                    <li>Haz clic en el botón <strong>Compartir</strong> (arriba a la derecha).</li>
                                    <li>En "Acceso general", selecciona <strong>"Cualquier persona con el enlace"</strong>.</li>
                                </ol>
                                <span className="help-note">Esto permite que la aplicación lea los datos sin pedirte login cada vez.</span>
                            </div>
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

            {/* GLOBAL CAMERA OVERLAY - position fixed, always on top */}
            {showCamera && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.92)',
                    zIndex: 99999,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem',
                    padding: '1rem'
                }}>
                    <p style={{ color: '#a5b4fc', fontWeight: '600', fontSize: '1rem', marginBottom: '0.25rem' }}>
                        📷 Coloca el DNI frente a la cámara
                    </p>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        style={{
                            width: '100%',
                            maxWidth: '480px',
                            borderRadius: '12px',
                            border: '2px solid #6366f1',
                            background: '#000'
                        }}
                    />
                    {ocrLoading ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                            <div className="ocr-spinner" />
                            <span style={{ color: '#fff', fontSize: '0.9rem' }}>Analizando DNI con OCR...</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                            <button
                                style={{
                                    background: '#6366f1',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '0.75rem 2rem',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                                onClick={handleCameraCapture}
                            >
                                📸 Capturar DNI
                            </button>
                            <button
                                style={{
                                    background: 'transparent',
                                    color: '#94a3b8',
                                    border: '1px solid #334155',
                                    borderRadius: '8px',
                                    padding: '0.75rem 1.5rem',
                                    fontSize: '1rem',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setShowCamera(false)}
                            >
                                Cancelar
                            </button>
                        </div>
                    )}
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
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                style={{ display: 'none' }}
            />
        </div>
    )
}

export default App
