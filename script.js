// --- Получение элементов DOM ---
const urlInput = document.getElementById('urlInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const loader = document.getElementById('loader');
const welcomeMessage = document.getElementById('welcomeMessage');
const reportContainer = document.getElementById('reportContainer');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const themeToggle = document.getElementById('themeToggle');
const htmlElement = document.documentElement;
const reportToolbar = document.getElementById('reportToolbar');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const copyReportBtn = document.getElementById('copyReportBtn');

// --- Управление темой ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    htmlElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
    themeToggle.querySelector('span').textContent = theme === 'light' ? '🌙' : '☀️';
}

themeToggle.addEventListener('click', () => {
    const currentTheme = htmlElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
});

// --- История проверок (localStorage) ---
let history = JSON.parse(localStorage.getItem('webInspectorHistory')) || [];
let currentReportData = null; // Для хранения данных текущего отчета

function saveHistory() {
    localStorage.setItem('webInspectorHistory', JSON.stringify(history));
}

function renderHistory() {
    historyList.innerHTML = '';
    if (history.length === 0) {
        historyList.innerHTML = '<p class="history-list__empty">История пуста</p>';
        return;
    }

    // Отображаем последние проверки сверху
    [...history].reverse().forEach(item => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-list__item';
        historyItem.innerHTML = `
            <div class="history-list__item-url">${item.url}</div>
            <div class="history-list__item-date">${item.date}</div>
            <div class="history-list__item-stats">
                <span style="color: #ef4444;">❌ ${item.stats.errors}</span>
                <span style="color: #f59e0b;">⚠️ ${item.stats.warnings}</span>
                <span style="color: #22c55e;">✅ ${item.stats.success}</span>
            </div>
        `;
        // При клике на историю - загружаем сохраненный результат
        historyItem.addEventListener('click', () => {
            displayResults(item.data, item.url);
        });
        historyList.appendChild(historyItem);
    });
}

clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите очистить всю историю?')) {
        history = [];
        saveHistory();
        renderHistory();
    }
});

// --- Валидация и подготовка URL ---
function formatUrl(url) {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }
    return url;
}

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

// --- Основная логика анализа ---
analyzeBtn.addEventListener('click', analyzeSite);
urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') analyzeSite();
});

// --- НОВАЯ ФУНКЦИЯ: Каскадный запрос через несколько прокси ---
async function fetchWithFallback(url) {
    const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`
    ];

    for (let i = 0; i < proxies.length; i++) {
        try {
            const startTime = performance.now();
            const response = await fetch(proxies[i]);
            
            if (!response.ok) {
                console.warn(`Прокси ${i + 1} вернул статус: ${response.status}`);
                continue; // Пробуем следующий прокси
            }

            const htmlText = await response.text();
            const endTime = performance.now();
            const loadTime = ((endTime - startTime) / 1000).toFixed(2);

            // Проверяем, что получили осмысленный HTML, а не пустую страницу или ошибку прокси
            if (htmlText.length > 200 && (htmlText.includes('<html') || htmlText.includes('<head'))) {
                return { htmlText, loadTime, proxyUsed: i + 1 };
            } else {
                 console.warn(`Прокси ${i + 1} вернул недостаточно данных`);
            }
        } catch (error) {
            console.warn(`Прокси ${i + 1} упал с ошибкой:`, error.message);
        }
    }
    
    throw new Error('PROXY_FAILED'); // Если ни один прокси не сработал
}

// --- ОБНОВЛЕННАЯ ЛОГИКА АНАЛИЗА ---
async function analyzeSite() {
    const rawUrl = urlInput.value;
    if (!rawUrl) {
        alert('Пожалуйста, введите URL сайта');
        return;
    }

    const formattedUrl = formatUrl(rawUrl);
    if (!isValidUrl(formattedUrl)) {
        alert('Некорректный URL. Пожалуйста, проверьте введенный адрес.');
        return;
    }

    // Показываем спиннер, прячем приветствие
    loader.classList.remove('hidden');
    welcomeMessage.style.display = 'none';
    reportContainer.innerHTML = '';
    reportToolbar.style.display = 'none'; // Скрываем кнопку экспорта при новом поиске

    let siteData = null;
    let report = [];
    let analysisStatus = 'success'; // success | limited

    try {
        // Пытаемся получить HTML через каскад прокси
        const { htmlText, loadTime } = await fetchWithFallback(formattedUrl);

        // Парсим полученный HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        // Сбор данных
        siteData = {
            title: doc.querySelector('title')?.innerText || '',
            description: doc.querySelector('meta[name="description"]')?.getAttribute('content') || '',
            keywords: doc.querySelector('meta[name="keywords"]')?.getAttribute('content') || '',
            viewport: doc.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
            h1: doc.querySelectorAll('h1').length,
            h2: doc.querySelectorAll('h2').length,
            h3: doc.querySelectorAll('h3').length,
            images: doc.querySelectorAll('img').length,
            links: doc.querySelectorAll('a').length,
            isHttps: formattedUrl.startsWith('https://'),
            loadTime: loadTime
        };

        report = generateReport(siteData);

    } catch (error) {
        // Если все прокси упали, генерируем только базовый отчет по URL
        analysisStatus = 'limited';
        siteData = {
            title: '', description: '', keywords: '', viewport: '',
            h1: 0, h2: 0, h3: 0, images: 0, links: 0,
            isHttps: formattedUrl.startsWith('https://'),
            loadTime: 0
        };
        
        report = [{
            type: 'critical',
            icon: '⚠️',
            title: 'Ограниченный анализ',
            desc: 'Сайт заблокировал парсинг кода (CORS/Cloudflare) или прокси недоступны. Рекомендации сгенерированы на основе доступной информации.',
            details: 'Мы не смогли получить HTML-код сайта для глубокого SEO-анализа. Ниже вы можете визуально посмотреть сам сайт (если он разрешает встраивание).'
        }];
        
        // Добавляем проверку HTTPS даже при ошибке парсинга
        if (siteData.isHttps) {
            report.push({ type: 'success', icon: '🔒', title: 'SSL-сертификат', desc: 'Сайт использует безопасное соединение HTTPS.', details: 'Передача данных зашифрована.' });
        } else {
            report.push({ type: 'critical', icon: '🔓', title: 'Отсутствует HTTPS', desc: 'Рекомендуем перейти на HTTPS.', details: 'Сайт загружается по незащищенному протоколу HTTP.' });
        }
    } finally {
        loader.classList.add('hidden');
    }

    // Сохраняем в историю
    const statsCount = {
        errors: report.filter(c => c.type === 'critical').length,
        warnings: report.filter(c => c.type === 'warning').length,
        success: report.filter(c => c.type === 'success').length
    };

    history.push({
        url: formattedUrl,
        date: new Date().toLocaleString('ru-RU'),
        stats: statsCount,
        data: { siteData, report, status: analysisStatus }
    });

    if (history.length > 15) history.shift();
    saveHistory();
    renderHistory();
    
    // Отрисовываем результаты
    displayResults({ siteData, report, status: analysisStatus }, formattedUrl);
}

// --- Генерация рекомендаций (по ТЗ) ---
function generateReport(data) {
    const report = [];

    // 1. SSL / HTTPS
    if (data.isHttps) {
        report.push({ type: 'success', icon: '🔒', title: 'SSL-сертификат', desc: 'Сайт использует безопасное соединение HTTPS.', details: 'Передача данных между сервером и пользователем зашифрована.' });
    } else {
        report.push({ type: 'critical', icon: '🔓', title: 'Отсутствует HTTPS', desc: 'Рекомендуем перейти на HTTPS.', details: 'Сайт загружается по незащищенному протоколу HTTP. Это небезопасно для пользователей и негативно влияет на SEO.' });
    }

    // 2. Title
    if (data.title) {
        report.push({ type: 'success', icon: '🏷️', title: 'Title присутствует', desc: `Заголовок страницы: "${data.title.substring(0, 50)}..."`, details: `Полный заголовок: ${data.title}` });
    } else {
        report.push({ type: 'critical', icon: '🏷️', title: 'Отсутствует Title', desc: 'Добавьте title для улучшения SEO.', details: 'Тег <title> отсутствует. Он критически важен для поисковых систем и отображения во вкладках браузера.' });
    }

    // 3. Description
    if (data.description) {
        report.push({ type: 'success', icon: '📝', title: 'Meta-description есть', desc: 'Описание страницы настроено.', details: `Текст описания: ${data.description.substring(0, 100)}...` });
    } else {
        report.push({ type: 'warning', icon: '📝', title: 'Отсутствует Description', desc: 'Добавьте meta-description.', details: 'Мета-тег description используется поисковыми системами для формирования сниппета в выдаче.' });
    }

    // 4. H1 Заголовок
    if (data.h1 > 0) {
        report.push({ type: 'success', icon: 'H1', title: 'Главный заголовок найден', desc: `На странице найдено H1: ${data.h1}`, details: 'Рекомендуется использовать только один тег <h1> на странице.' });
    } else {
        report.push({ type: 'critical', icon: 'H1', title: 'Отсутствует H1', desc: 'Добавьте заголовок h1.', details: 'Тег <h1> — главный заголовок страницы. Его отсутствие серьезно вредит SEO.' });
    }

    // 5. Количество заголовков (меньше 3)
    const totalHeaders = data.h1 + data.h2 + data.h3;
    if (totalHeaders < 3 && totalHeaders > 0) {
        report.push({ type: 'warning', icon: '⚠️', title: 'Мало заголовков', desc: 'Используйте больше заголовков для структурирования контента.', details: `На странице всего ${totalHeaders} заголовков (H1-H3). Структурируйте контент подзаголовками.` });
    } else if (totalHeaders >= 3) {
        report.push({ type: 'success', icon: '✅', title: 'Хорошая структура заголовков', desc: `Найдено заголовков: H1(${data.h1}), H2(${data.h2}), H3(${data.h3})`, details: 'Контент хорошо структурирован.' });
    }

    // 6. Количество ссылок (больше 50)
    if (data.links > 50) {
        report.push({ type: 'warning', icon: '🔗', title: 'Слишком много ссылок', desc: 'Слишком много ссылок, проверьте их качество.', details: `На странице найдено ${data.links} ссылок. Избыток ссылок может размыть вес страницы и ухудшить пользовательский опыт.` });
    } else {
        report.push({ type: 'stats', icon: '🔗', title: 'Статистика ссылок', desc: `Всего ссылок на странице: ${data.links}`, details: 'Количество ссылок в пределах нормы.' });
    }

    // 7. Viewport (адаптивность)
    if (data.viewport) {
        report.push({ type: 'success', icon: '📱', title: 'Мобильная адаптация', desc: 'Найден мета-тег viewport.', details: `Настройки viewport: ${data.viewport}` });
    } else {
        report.push({ type: 'warning', icon: '📱', title: 'Нет адаптивности', desc: 'Добавьте мета-тег viewport для мобильной адаптации.', details: 'Отсутствует <meta name="viewport">. Сайт может некорректно отображаться на мобильных устройствах.' });
    }

    // 8. Статистика (изображения)
    report.push({ type: 'stats', icon: '🖼️', title: 'Изображения', desc: `Количество картинок на странице: ${data.images}`, details: 'Убедитесь, что у всех изображений прописан атрибут alt для SEO.' });
    
    // 9. Статистика (Время загрузки)
    let loadTimeType = 'success';
    if (data.loadTime > 3) loadTimeType = 'critical';
    else if (data.loadTime > 1.5) loadTimeType = 'warning';
    
    report.push({ type: loadTimeType, icon: '⚡', title: 'Скорость загрузки', desc: `Время загрузки HTML: ~${data.loadTime} сек.`, details: 'Время замеряется от начала запроса до получения HTML через прокси-сервер. Реальное время в браузере пользователя может отличаться.' });

    return report;
}

// --- ОБНОВЛЕННАЯ Отрисовка результатов ---
function displayResults(data, url) {
    welcomeMessage.style.display = 'none';
    reportContainer.innerHTML = '';

    // Сохраняем данные для копирования
    currentReportData = { data, url }; 

    // 1. Добавляем iframe для визуального просмотра
    const iframeWrapper = document.createElement('div');
    iframeWrapper.className = 'report__iframe-wrapper';
    
    // Добавляем предупреждение, если анализ был ограничен
    const noticeHtml = data.status === 'limited' 
        ? '<div class="report__iframe-notice">⚠️ Визуальный просмотр может быть недоступен из-за настроек безопасности сайта (X-Frame-Options)</div>' 
        : '';
        
    iframeWrapper.innerHTML = `
        ${noticeHtml}
        <iframe src="${url}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
    `;
    reportContainer.appendChild(iframeWrapper);

    // 2. Создаем сетку для карточек
    const grid = document.createElement('div');
    grid.className = 'report__grid';
    reportContainer.appendChild(grid);

    // 3. Отрисовываем карточки с stagger-эффектом
    data.report.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = `report-card report-card--${item.type}`;
        card.style.animationDelay = `${index * 0.1}s`; // Stagger анимация
        
        card.innerHTML = `
            <div class="report-card__header">
                <span>${item.icon}</span>
                <span>${item.title}</span>
            </div>
            <div class="report-card__description">${item.desc}</div>
            <button class="report-card__toggle-btn">Подробнее</button>
            <div class="report-card__details">${item.details}</div>
        `;

        // Логика кнопки "Подробнее"
        const toggleBtn = card.querySelector('.report-card__toggle-btn');
        const details = card.querySelector('.report-card__details');
        toggleBtn.addEventListener('click', () => {
            details.classList.toggle('active');
            toggleBtn.textContent = details.classList.contains('active') ? 'Скрыть' : 'Подробнее';
        });

        grid.appendChild(card);
    });
    reportToolbar.style.display = 'flex'; // Показываем кнопку экспорта
}

// --- ЛОГИКА МОДАЛЬНОГО ОКНА ---
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModalBtn = document.getElementById('closeModalBtn');

// Открытие окна
infoBtn.addEventListener('click', () => {
    infoModal.classList.add('active');
});

// Закрытие по крестику
closeModalBtn.addEventListener('click', () => {
    infoModal.classList.remove('active');
});

// Закрытие по клику на затемненный фон
infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) {
        infoModal.classList.remove('active');
    }
});

// Закрытие по нажатию Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infoModal.classList.contains('active')) {
        infoModal.classList.remove('active');
    }
});

// --- ЛОГИКА ЭКСПОРТА В PDF ---
exportPdfBtn.addEventListener('click', () => {
    // Небольшая задержка, чтобы интерфейс успел обновиться (особенно если развернуты какие-то карточки)
    setTimeout(() => {
        window.print();
    }, 100);
});

// --- ЛОГИКА КОПИРОВАНИЯ В БУФЕР ОБМЕНА ---
copyReportBtn.addEventListener('click', () => {
    if (!currentReportData) return;

    const { data, url } = currentReportData;
    let textToCopy = `🔍 Отчет WebInspector: ${url}\n`;
    textToCopy += `Дата проверки: ${new Date().toLocaleString('ru-RU')}\n\n`;

    // Формируем текст из всех карточек
    data.report.forEach(item => {
        let typeText = '';
        if (item.type === 'critical') typeText = '❌ Ошибка';
        if (item.type === 'warning') typeText = '⚠️ Предупреждение';
        if (item.type === 'success') typeText = '✅ Успех';
        if (item.type === 'stats') typeText = '📊 Статистика';

        textToCopy += `${typeText}: ${item.title}\n`;
        textToCopy += `${item.desc}\n`;
        if (item.details) textToCopy += `Детали: ${item.details}\n`;
        textToCopy += `----------------------------------------\n`;
    });

    // Копируем в буфер обмена
    navigator.clipboard.writeText(textToCopy).then(() => {
        // Визуальная обратная связь
        const originalText = copyReportBtn.innerHTML;
        copyReportBtn.innerHTML = '<span>✅</span> Скопировано!';
        
        // Возвращаем исходный текст кнопки через 2 секунды
        setTimeout(() => {
            copyReportBtn.innerHTML = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Ошибка копирования: ', err);
        alert('Не удалось скопировать отчет. Ваш браузер не поддерживает эту функцию или требует HTTPS.');
    });
});

// --- Инициализация при загрузке страницы ---
initTheme();
renderHistory();