import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { policies } from "./policies.js";

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

function getStageInfo(points, jobName) {
    jobName = jobName || "직업";
    if (points < 10) return { stage: 1, name: "알", col: "2%", min: 0, max: 10, nextName: `초급 ${jobName}` }; 
    if (points < 30) return { stage: 2, name: `초급 ${jobName}`, col: "50%", min: 10, max: 30, nextName: `중급 ${jobName}` }; 
    if (points < 60) return { stage: 3, name: `중급 ${jobName}`, col: "74%", min: 30, max: 60, nextName: `베테랑 ${jobName}` }; 
    return { stage: 4, name: `베테랑 ${jobName}`, col: "98%", min: 60, max: 100, nextName: "다음 직업" }; 
}

// --- App State ---
let currentUserData = null;
let currentRole = null; // 'teacher' or 'student'
let studentsUnsubscribe = null;
let teacherUnsubscribe = null;
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
                try {
                    // Fetch user data from firestore
                    let userDoc = await getDoc(doc(db, "users", user.uid));
                    
                    // 회원가입 직후(createUserWithEmailAndPassword) Auth 상태가 먼저 변하고 
                    // DB 저장이 나중에 되어 문서를 못 찾는 타이밍 이슈(Race condition)를 해결하기 위해 1초 대기 후 재시도
                    if (!userDoc.exists()) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        userDoc = await getDoc(doc(db, "users", user.uid));
                    }

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
                        alert('사용자 정보를 찾을 수 없습니다. (데이터베이스에 계정 정보가 없습니다.) 계정을 새로 가입해주세요.');
                        this.logout();
                    }
                } catch (error) {
                    console.error("Firestore Error in onAuthStateChanged:", error);
                    alert(`데이터베이스 오류로 화면을 불러오지 못했습니다: ${error.message}\n(Firebase 콘솔에서 Firestore Database가 생성되었는지, 규칙이 허용되어 있는지 확인해주세요.)`);
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
        if (document.getElementById('teacher-signup-extra')) {
            document.getElementById('teacher-signup-extra').classList.add('hidden');
        }
        
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
                document.getElementById('teacher-signup-extra').classList.add('hidden');
            } else {
                document.getElementById('signup-extra').classList.add('hidden');
                document.getElementById('teacher-signup-extra').classList.remove('hidden');
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
                if (targetAuthRole === 'teacher') {
                    const teacherCode = document.getElementById('auth-teacher-code').value.trim();
                    if (teacherCode !== '20260703') {
                        alert('교사 인증 코드가 올바르지 않습니다.');
                        return;
                    }
                }

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
                
                alert('환영합니다! 가입 완료되었습니다.');
            } else {
                await signInWithEmailAndPassword(auth, email, password);
                alert('로그인 성공! 환영합니다.');
            }
        } catch (error) {
            console.error("Auth Error:", error);
            let errorMessage = error.message;
            if (error.code === 'auth/weak-password') {
                errorMessage = "비밀번호는 6자리 이상이어야 합니다.";
            } else if (error.code === 'auth/email-already-in-use') {
                errorMessage = "이미 가입된 아이디(닉네임)입니다.";
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMessage = "Firebase 콘솔에서 이메일/비밀번호 로그인이 활성화되어 있지 않습니다. (Firebase 설정 확인 필요)";
            } else if (error.code === 'auth/configuration-not-found') {
                errorMessage = "Firebase 프로젝트에 인증(Authentication)이 설정되지 않았습니다. Firebase 콘솔에서 Authentication을 시작하고 이메일/비밀번호 로그인을 활성화해주세요.";
            } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                errorMessage = "아이디 또는 비밀번호가 일치하지 않습니다.";
            } else if (error.code === 'permission-denied') {
                errorMessage = "데이터베이스 접근 권한이 없습니다. Firebase 콘솔에서 Firestore 규칙(Rules)을 확인해주세요.";
            }
            alert(`인증 오류: ${errorMessage}`);
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
        if (teacherUnsubscribe) {
            teacherUnsubscribe();
            teacherUnsubscribe = null;
        }
        this.showView('view-login');
        this.showRoleSelection();
    },

    // --- Teacher Actions ---
    startTeacherListener() {
        const container = document.getElementById('student-rows');
        
        // Listen to teacher's own document for custom buttons
        teacherUnsubscribe = onSnapshot(doc(db, "users", currentUserData.id), (docSnap) => {
            if (!document.getElementById('view-teacher').classList.contains('active')) return;
            if (docSnap.exists()) {
                currentUserData = { id: docSnap.id, ...docSnap.data() };
                this.renderCustomButtons();
            }
        });
        
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
                const jobName = JOBS[s.jobIndex];
                const stage = getStageInfo(s.points, jobName);
                const isChecked = checkedState[s.id] ? 'checked' : '';
                html += `
                    <div class="student-card" onclick="const cb = document.getElementById('chk-${s.id}'); cb.checked = !cb.checked; event.stopPropagation();">
                        <input type="checkbox" id="chk-${s.id}" class="student-check" value="${s.id}" ${isChecked} onclick="event.stopPropagation();">
                        <div class="student-card-name">${s.name}</div>
                        <div class="student-card-job">[${jobName}]<br>${stage.name}</div>
                        <div class="student-card-exp">${s.points} P</div>
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

    renderCustomButtons() {
        const container = document.querySelector('.eval-actions');
        container.innerHTML = '';
        
        // 기존에 버튼을 만들었던 분들도 기본 버튼이 한 번은 추가되도록 마이그레이션 플래그 사용
        if (!currentUserData.hasInitializedDefaults) {
            const defaultButtons = [
                { points: 1, reason: '숙제 완료' },
                { points: 1, reason: '태도 우수' },
                { points: -1, reason: '태도 불량' }
            ];
            
            if (!currentUserData.customButtons) {
                currentUserData.customButtons = defaultButtons;
            } else {
                // 이미 커스텀 버튼이 있다면 기본 버튼을 앞에 추가
                currentUserData.customButtons = [...defaultButtons, ...currentUserData.customButtons];
            }
            currentUserData.hasInitializedDefaults = true;
            
            updateDoc(doc(db, "users", currentUserData.id), {
                customButtons: currentUserData.customButtons,
                hasInitializedDefaults: true
            }).catch(e => console.error("Error saving default buttons:", e));
        }
        
        const buttons = currentUserData.customButtons || [];
        
        buttons.forEach((btnData, index) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-eval custom-btn-eval';
            btn.innerText = `${btnData.reason} (${btnData.points > 0 ? '+'+btnData.points : btnData.points}점)`;
            btn.title = "우클릭하여 삭제";
            btn.onclick = () => this.givePoints(btnData.points, btnData.reason);
            btn.oncontextmenu = (e) => {
                e.preventDefault();
                this.deleteCustomButton(index);
            };
            container.appendChild(btn);
        });
    },

    async saveCustomButton() {
        const amount = parseInt(document.getElementById('custom-point').value);
        const reason = document.getElementById('custom-reason').value.trim();
        if (!reason || isNaN(amount)) { alert('점수와 사유를 올바르게 입력하세요.'); return; }
        
        const buttons = currentUserData.customButtons || [];
        buttons.push({ points: amount, reason: reason });
        
        try {
            await updateDoc(doc(db, "users", currentUserData.id), {
                customButtons: buttons
            });
            document.getElementById('custom-reason').value = '';
        } catch (e) {
            console.error("Error saving custom button: ", e);
            alert("버튼 저장에 실패했습니다.");
        }
    },

    async deleteCustomButton(index) {
        if (!confirm("이 버튼을 삭제하시겠습니까?")) return;
        
        const buttons = currentUserData.customButtons || [];
        buttons.splice(index, 1);
        
        try {
            await updateDoc(doc(db, "users", currentUserData.id), {
                customButtons: buttons
            });
        } catch (e) {
            console.error("Error deleting custom button: ", e);
            alert("버튼 삭제에 실패했습니다.");
        }
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
        
        const jobName = JOBS[currentUserData.jobIndex];
        const jobNameEn = JOBS_EN[currentUserData.jobIndex];
        const stage = getStageInfo(currentUserData.points, jobName);
        const nextJobIndex = (currentUserData.jobIndex + 1) % JOBS.length;
        
        document.getElementById('job-badge').innerText = jobName;
        document.getElementById('stage-badge').innerText = `${stage.name} (${stage.stage}단계)`;
        
        const sprite = document.getElementById('character-sprite');
        
        // 기사(knight) 특수 이미지 처리
        if (jobNameEn === 'knight') {
            if (stage.stage === 1) {
                sprite.style.backgroundImage = `url('knight_egg.png')`;
                sprite.style.backgroundSize = '115%'; // 살짝 확대
                sprite.style.backgroundPosition = 'center';
            } else if (stage.stage === 2) {
                if (currentUserData.gender === 'male') {
                    sprite.style.backgroundImage = `url('knight_2_boy.png')`;
                } else {
                    sprite.style.backgroundImage = `url('knigh_2_girl.png')`;
                }
                sprite.style.backgroundSize = 'contain';
                sprite.style.backgroundPosition = 'center';
            } else if (stage.stage === 3) {
                if (currentUserData.gender === 'male') {
                    sprite.style.backgroundImage = `url('knight_3_boy.png')`;
                } else {
                    sprite.style.backgroundImage = `url('knight_3_girl.png')`;
                }
                sprite.style.backgroundSize = 'contain';
                sprite.style.backgroundPosition = 'center';
            } else if (stage.stage === 4) {
                if (currentUserData.gender === 'male') {
                    sprite.style.backgroundImage = `url('knight_4_boy.png')`;
                } else {
                    sprite.style.backgroundImage = `url('knight_4_girl.png')`;
                }
                sprite.style.backgroundSize = 'contain';
                sprite.style.backgroundPosition = 'center';
            } else {
                sprite.style.backgroundImage = `url('${jobNameEn}.png')`;
                const yPos = currentUserData.gender === 'male' ? '18%' : '98%';
                sprite.style.backgroundPosition = `${stage.col} ${yPos}`;
                sprite.style.backgroundSize = ''; // 기본 CSS 값으로 초기화
            }
        } else {
            sprite.style.backgroundImage = `url('${jobNameEn}.png')`;
            const yPos = currentUserData.gender === 'male' ? '18%' : '98%';
            sprite.style.backgroundPosition = `${stage.col} ${yPos}`;
            sprite.style.backgroundSize = ''; // 기본 CSS 값으로 초기화
        }
        
        // Calculate EXP relative to current stage
        const currentExp = currentUserData.points - stage.min;
        const maxExp = stage.max - stage.min;
        const expPercent = Math.min(100, Math.max(0, (currentExp / maxExp) * 100));
        
        document.getElementById('exp-bar').style.width = `${expPercent}%`;
        document.getElementById('exp-text').innerText = `${currentExp} / ${maxExp}`;
        
        if (stage.stage === 4) {
            document.getElementById('next-unlock').innerText = `다음 해금: ${JOBS[nextJobIndex]}`;
        } else {
            document.getElementById('next-unlock').innerText = `다음 단계: ${stage.nextName}`;
        }

        const logHtml = currentUserData.history.map(h => {
            const isPos = h.text.includes('+') || h.text.includes('🎉');
            return `<div class="log-entry ${isPos ? 'positive' : 'negative'}">[${h.time}] ${h.text}</div>`;
        }).join('');
        document.getElementById('history-log').innerHTML = logHtml;
    },

    // --- Modal Logic ---
    showModal(type) {
        document.getElementById('modal-title').innerText = type === 'terms' ? '이용약관' : '개인정보처리방침';
        document.getElementById('modal-body').innerHTML = policies[type];
        document.getElementById('info-modal').style.display = 'block';
    },

    closeModal() {
        document.getElementById('info-modal').style.display = 'none';
    }
};

// 모달 외부 클릭 시 닫기
window.onclick = function(event) {
    const modal = document.getElementById('info-modal');
    if (event.target === modal) {
        app.closeModal();
    }
}

window.onload = () => app.init();
