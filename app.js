import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// TODO: 아래에 Firebase 프로젝트 설정 정보를 붙여넣으세요!
const firebaseConfig = {
  apiKey: "AIzaSyBJSwKntv5_ot7DoBkEdc15UT71WDbNwC0",
  authDomain: "hero-4-3.firebaseapp.com",
  projectId: "hero-4-3",
  storageBucket: "hero-4-3.firebasestorage.app",
  messagingSenderId: "540688657991",
  appId: "1:540688657991:web:68f368572b91b3d3d68b62"
};

let appInstance = null;
let auth = null;
let db = null;

try {
    appInstance = initializeApp(firebaseConfig);
    auth = getAuth(appInstance);
    db = getFirestore(appInstance);
} catch (e) {
    console.error("Firebase 초기화 에러: 설정값을 확인해주세요.", e);
}

// --- Game Logic ---
const JOBS = ["기사", "마법사", "소환사"];
const JOBS_EN = ["knight", "mage", "summoner"];

function getStageInfo(points) {
    if (points < 10) return { stage: 1, name: "알", col: "2%" }; // 1st
    if (points < 30) return { stage: 2, name: "기본", col: "50%" }; // 3rd (기본2)
    if (points < 60) return { stage: 3, name: "진화", col: "74%" }; // 4th
    return { stage: 4, name: "최종", col: "98%" }; // 5th
}

// --- App State ---
let currentUserData = null;
let currentRole = null; // 'teacher' or 'student'
let studentsUnsubscribe = null;
let currentMode = 'login'; // 'login' or 'signup'
let targetAuthRole = null; // 'teacher' or 'student'

// --- UI Logic ---
window.app = {
    init() {
        this.showView('view-login');
        
        if (!auth) {
            alert("Firebase 설정이 올바르지 않습니다. app.js의 firebaseConfig를 확인해주세요!");
            return;
        }

        // Listen to auth state changes
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // Fetch user data from firestore
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    currentUserData = { id: user.uid, ...userDoc.data() };
                    currentRole = currentUserData.role;
                    
                    if (currentRole === 'teacher') {
                        this.showView('view-teacher');
                        this.startTeacherListener();
                    } else {
                        this.showView('view-student');
                        this.startStudentListener();
                    }
                } else {
                    // DB에 정보가 없는 경우 (회원가입 도중 이탈 등)
                    alert('사용자 정보를 찾을 수 없습니다.');
                    this.logout();
                }
            } else {
                this.logoutUI();
            }
        });
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
    },

    showRoleSelection() {
        document.getElementById('role-selection').classList.remove('hidden');
        document.getElementById('auth-form').classList.add('hidden');
    },

    showLogin(role) {
        targetAuthRole = role;
        currentMode = 'login';
        
        document.getElementById('role-selection').classList.add('hidden');
        document.getElementById('auth-form').classList.remove('hidden');
        document.getElementById('signup-extra').classList.add('hidden');
        
        document.getElementById('auth-title').innerText = role === 'teacher' ? '교사 로그인' : '학생 로그인';
        document.getElementById('auth-submit-btn').innerText = '로그인';
        
        document.getElementById('auth-toggle-btn').classList.remove('hidden');
        document.getElementById('auth-toggle-btn').innerText = '회원가입하기';
        
        // Reset fields
        document.getElementById('auth-nickname').value = '';
        document.getElementById('auth-password').value = '';
    },

    toggleAuthMode() {
        if (currentMode === 'login') {
            currentMode = 'signup';
            document.getElementById('auth-title').innerText = targetAuthRole === 'teacher' ? '교사 회원가입' : '학생 회원가입';
            document.getElementById('auth-submit-btn').innerText = '회원가입';
            document.getElementById('auth-toggle-btn').innerText = '로그인으로 돌아가기';
            
            if (targetAuthRole === 'student') {
                document.getElementById('signup-extra').classList.remove('hidden');
            } else {
                document.getElementById('signup-extra').classList.add('hidden');
            }
        } else {
            currentMode = 'login';
            this.showLogin(targetAuthRole);
        }
    },

    async submitAuth() {
        const nickname = document.getElementById('auth-nickname').value.trim();
        const password = document.getElementById('auth-password').value;
        
        if (!nickname || !password) {
            alert('닉네임(아이디)과 비밀번호를 입력해주세요.');
            return;
        }

        // Firebase Auth requires email format, so we create a dummy email
        const email = nickname + '@hero.local';

        try {
            if (currentMode === 'signup') {
                const name = targetAuthRole === 'teacher' ? '교사' : nickname;
                const gender = targetAuthRole === 'student' ? document.querySelector('input[name="auth-gender"]:checked').value : 'none';

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                // Create document in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    email: email,
                    name: name,
                    gender: gender,
                    role: targetAuthRole,
                    points: 0,
                    jobIndex: 0,
                    history: []
                });
                
                alert('회원가입 완료! 로그인 되었습니다.');
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            alert(`인증 오류: ${error.message}`);
        }
    },

    logout() {
        if(auth) signOut(auth);
    },
    
    logoutUI() {
        currentUserData = null;
        currentRole = null;
        if (studentsUnsubscribe) {
            studentsUnsubscribe();
            studentsUnsubscribe = null;
        }
        this.showView('view-login');
        this.showRoleSelection();
    },

    // --- Teacher Actions ---
    startTeacherListener() {
        const container = document.getElementById('student-rows');
        
        // Listen to all students changes in real-time
        studentsUnsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
            if (!document.getElementById('view-teacher').classList.contains('active')) return;

            const students = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.role === 'student') {
                    students.push({ id: doc.id, ...data });
                }
            });
            
            // Save current checked state
            const checkedState = {};
            document.querySelectorAll('.student-check').forEach(el => {
                checkedState[el.value] = el.checked;
            });

            let html = '';
            students.forEach(s => {
                const stage = getStageInfo(s.points);
                const jobName = JOBS[s.jobIndex];
                const isChecked = checkedState[s.id] ? 'checked' : '';
                html += `
                    <div class="student-row">
                        <input type="checkbox" class="student-check" value="${s.id}" ${isChecked}>
                        <span>${s.name}</span>
                        <span>${jobName} (${stage.name})</span>
                        <strong style="color: #27ae60;">${s.points} P</strong>
                    </div>
                `;
            });
            container.innerHTML = html;
        });
    },

    toggleCheckAll() {
        const checkAll = document.getElementById('check-all').checked;
        document.querySelectorAll('.student-check').forEach(el => el.checked = checkAll);
    },

    async givePoints(amount, reason) {
        const checked = document.querySelectorAll('.student-check:checked');
        if (checked.length === 0) { alert('포인트를 부여할 학생을 먼저 선택해주세요.'); return; }
        
        for (const el of checked) {
            const studentId = el.value;
            try {
                const studentRef = doc(db, "users", studentId);
                const studentSnap = await getDoc(studentRef);
                if (studentSnap.exists()) {
                    let sData = studentSnap.data();
                    sData.points += amount;
                    
                    if (sData.points >= 100) {
                        sData.points = 0;
                        sData.jobIndex = (sData.jobIndex + 1) % JOBS.length;
                        sData.history.unshift({ time: new Date().toLocaleTimeString(), text: `🎉 [${JOBS[sData.jobIndex]}] 직업 달성!` });
                    } else if (sData.points < 0) {
                        sData.points = 0;
                    }

                    sData.history.unshift({ 
                        time: new Date().toLocaleTimeString(), 
                        text: `${reason} (${amount > 0 ? '+'+amount : amount}P)` 
                    });
                    
                    await updateDoc(studentRef, {
                        points: sData.points,
                        jobIndex: sData.jobIndex,
                        history: sData.history
                    });
                }
            } catch (e) {
                console.error("Error updating points: ", e);
            }
        }
        
        document.getElementById('check-all').checked = false;
    },

    giveCustomPoints() {
        const amount = parseInt(document.getElementById('custom-point').value);
        const reason = document.getElementById('custom-reason').value.trim();
        if (!reason || isNaN(amount)) { alert('점수와 사유를 올바르게 입력하세요.'); return; }
        this.givePoints(amount, reason);
        document.getElementById('custom-reason').value = '';
    },

    // --- Student Actions ---
    startStudentListener() {
        if (!currentUserData) return;
        
        studentsUnsubscribe = onSnapshot(doc(db, "users", currentUserData.id), (docSnapshot) => {
            if (!document.getElementById('view-student').classList.contains('active')) return;
            
            if (docSnapshot.exists()) {
                currentUserData = { id: docSnapshot.id, ...docSnapshot.data() };
                this.renderStudentDashboard();
            }
        });
    },
    
    renderStudentDashboard() {
        if (!currentUserData) return;

        document.getElementById('student-display-name').innerText = currentUserData.name;
        
        const stage = getStageInfo(currentUserData.points);
        const jobName = JOBS[currentUserData.jobIndex];
        const jobNameEn = JOBS_EN[currentUserData.jobIndex];
        const nextJobIndex = (currentUserData.jobIndex + 1) % JOBS.length;
        
        document.getElementById('job-badge').innerText = jobName;
        document.getElementById('stage-badge').innerText = `${stage.name} (${stage.stage}단계)`;
        
        const sprite = document.getElementById('character-sprite');
        sprite.style.backgroundImage = `url('${jobNameEn}.png')`;
        
        const yPos = currentUserData.gender === 'male' ? '18%' : '98%';
        sprite.style.backgroundPosition = `${stage.col} ${yPos}`;
        
        const expPercent = Math.min(100, Math.max(0, currentUserData.points));
        document.getElementById('exp-bar').style.width = `${expPercent}%`;
        document.getElementById('exp-text').innerText = `${currentUserData.points} / 100`;
        
        document.getElementById('next-unlock').innerText = `다음 직업 해금: ${JOBS[nextJobIndex]}`;

        const logHtml = currentUserData.history.map(h => {
            const isPos = h.text.includes('+') || h.text.includes('🎉');
            return `<div class="log-entry ${isPos ? 'positive' : 'negative'}">[${h.time}] ${h.text}</div>`;
        }).join('');
        document.getElementById('history-log').innerHTML = logHtml;
    }
};

window.onload = () => app.init();
