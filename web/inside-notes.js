/** Pulse advice copy for satellite notes. Stored notes keep English + id/vars; UI localizes. */
export const INSIDE_NOTE_LANGS = ["en", "ru", "es", "ko"];

const BIND_DO_EN =
  "In docker-compose bind those services to loopback. Example: 6379:6379 → 127.0.0.1:6379:6379. Same for 5432, 7474 and the other orange labels. Then only programs on this server can connect. Orb44 will not edit the file.";
const BIND_DO_RU =
  "В docker-compose у этих сервисов поставьте 127.0.0.1 перед номером. Пример: было 6379:6379, нужно 127.0.0.1:6379:6379. Так же для 5432, 7474 и остальных оранжевых меток. Тогда к базе подключатся только программы на этом сервере. Orb44 файл сам не изменит.";
const BIND_DO_ES =
  "En docker-compose ate esos servicios a loopback. Ejemplo: 6379:6379 → 127.0.0.1:6379:6379. Igual para 5432, 7474 y el resto de etiquetas naranjas. Así solo conectan programas de este servidor. Orb44 no edita el archivo.";
const BIND_DO_KO =
  "docker-compose에서 해당 서비스를 루프백에 묶으세요. 예: 6379:6379 → 127.0.0.1:6379:6379. 5432, 7474와 나머지 주황 표시도 같습니다. 그러면 이 서버의 프로그램만 접속합니다. Orb44는 파일을 고치지 않습니다.";

export const INSIDE_NOTES = {
  en: {
    _no_top: "top process not visible",
    _ssh_password: "password login is on",
    _ssh_root: "root may log in over SSH",
    _ssh_world: "port 22 listens on the whole network",
    "listen-leaked": {
      title: "Service ports answer from the street",
      text: "The machine listens on {names} at 0.0.0.0, and the internet snapshot got a service banner on those ports, not an empty SYN-ACK. This is not “the firewall probably holds” — the socket is open outside.",
      do: "Close the port on the panel firewall first and bind 127.0.0.1 in docker-compose. Orb44 does not enable the firewall or edit compose.",
    },
    "listen-open-held": {
      title: "Databases listen on the server network, silent from the street",
      text: "Right now {names} accept connections from any address on this machine. The internet snapshot got no service banner on those ports — the firewall is holding. If someone opens the port on the VPS panel, anyone can reach the database, not only your site.",
      do: BIND_DO_EN,
    },
    "listen-open": {
      title: "Databases listen on the whole server network",
      text: "Right now {names} accept connections not only from programs on this machine, but from any of its network addresses. The internet may not see them: the VPS firewall is probably closed. If the port is opened, anyone can reach Redis or Postgres, not only your site.",
      do: BIND_DO_EN,
    },
    "origin-mismatch": {
      title: "Machine address did not match the snapshot",
      text: "On the machine {machine}, from outside A={street}. Another box or a grey shield.",
      do: "Check that DNS A points at the VPS where you installed the satellite. If the site is behind Cloudflare, that is expected — not an incident.",
    },
    "load-street": {
      title: "Load and an open login",
      text: "The machine is under load and login is open from outside — looks like they are hitting login. Top: {who}.",
      do: "Start with storefront login, not processes. The satellite only confirms the CPU is live.",
    },
    "load-local": {
      title: "Machine is heavy, storefront is quiet",
      text: "Load is local, quiet from outside — not a storefront attack. Top: {who}.",
      do: "Look at the top process (worker, docker). The WAF is not involved.",
    },
    stuffing: {
      title: "fail2ban is stacking bans, street login is hot",
      text: "Currently banned: {banned}. We do not guess passwords — this is someone else’s stuffing; the satellite only counts.",
      do: "Check fail2ban and the storefront login form. Orb44 does not brute-force passwords.",
    },
    "stuffing-watch": {
      title: "Load and an open login",
      text: "The machine is under load and login is hot from outside — looks like they are hitting login, not a local worker. Top: {who}. We do not guess passwords.",
    },
    "stuffing-ssh": {
      title: "fail2ban is stacking SSH bans",
      text: "Was {from}, now {to}. Outside SSH stuffing, not storefront login. We do not guess passwords.",
    },
    "hardening-min": {
      title: "No baseline protection in sight",
      text: "No enabled firewall and no fail2ban. Extra ports and SSH guessing are not cut.",
      do: "Enable ufw and fail2ban on the host. Orb44 does not install packages.",
    },
    "hardening-fw": {
      title: "Firewall not visible",
      text: "No enabled ufw, nftables, or firewalld. Then orange database ports are not “closed by the firewall” — they are open on the server network.",
      do: "Enable ufw and close extra ports. Orb44 does not enable the firewall.",
    },
    "hardening-ban": {
      title: "No SSH brute-force protection",
      text: "fail2ban or sshguard is not running. Repeat SSH logins are not cut.",
      do: "Install and enable fail2ban on the host. Orb44 does not install packages.",
    },
    "hardening-ssh": {
      title: "SSH is weaker than it should be",
      text: "{bits}. We do not guess passwords — these are live sshd settings, not /etc/shadow.",
      do: "In sshd: PasswordAuthentication no and PermitRootLogin no. Better not expose port 22 to the whole network. Orb44 does not edit sshd.",
    },
    "hardening-docker": {
      title: "Docker API listens on the server network",
      text: "Port 2375 or 2376 accepts connections not only from this machine. The street firewall may still hide it, but the socket is already not loopback.",
      do: "Stop publishing the Docker API. A unix socket is enough. Orb44 does not touch Docker.",
    },
    "hardening-reboot": {
      title: "Kernel is waiting for a reboot",
      text: "/var/run/reboot-required is on disk — kernel packages landed, the machine is still on the old one.",
      do: "Plan a reboot in a window. Orb44 does not reboot the server.",
    },
    "hardening-timesync": {
      title: "Machine clock is not syncing",
      text: "No chrony, systemd-timesyncd, or ntp in sight. A wrong clock breaks TLS and log review.",
      do: "Enable systemd-timesyncd or chrony. Orb44 does not install packages.",
    },
    "hardening-lsm": {
      title: "No AppArmor and no SELinux",
      text: "On Linux there is no AppArmor and no enforcing SELinux. Not a hole by itself, but the process is not confined.",
      do: "On Ubuntu, apparmor is usually enough. Orb44 does not enable LSM.",
    },
    "hardening-disk": {
      title: "Disk is almost full",
      text: "Root is {pct}% full. Logs and updates will fail before the storefront does.",
      do: "Clean logs and unused Docker images. Orb44 does not delete files.",
    },
    "hardening-oom": {
      title: "The kernel killed processes for memory",
      text: "vmstat oom_kill={oomKills}. Something already hit RAM.",
      do: "Check the RAM top and container limits. Orb44 does not kill or restart processes.",
    },
    "hardening-oom-flag": {
      title: "The kernel killed processes for memory",
      text: "The pulse flagged OOM.",
      do: "Check the RAM top and container limits. Orb44 does not kill or restart processes.",
    },
    "ssh-fails": {
      title: "SSH is knocking from the street",
      text: "In {windowMin} min of journal: Failed password {failed}, Invalid user {invalid}. We do not keep IPs.",
      do: "Keys instead of passwords, and fail2ban on sshd. Orb44 does not brute-force logins or export journal.",
    },
    "ssh-fails-watch": {
      title: "SSH Failed password in bursts",
      text: "In {windowMin} min Failed password {failed}. We do not keep IPs.",
    },
    "mail-relay": {
      title: "Looks like an open relay",
      text: "{kind}: mynetworks contains 0.0.0.0/0. A stranger can send spam through this box. We do not read the queue or mail.",
      do: "In postfix, narrow mynetworks to the local net and keep reject_unauth_destination. Orb44 does not edit postconf.",
    },
    "mail-relay-watch": {
      title: "Open mail relay",
      text: "{kind}: mynetworks 0.0.0.0/0.",
    },
    "mail-queue": {
      title: "Mail queue is thick",
      text: "{kind}: {queue} messages in the queue. Happens during a mailing or when the relay will not accept. We do not look at queue bodies.",
      do: "On the machine: postqueue -p / mailq — who the sender is. Orb44 does not send mail or flush the queue.",
    },
    "mail-queue-grew": {
      title: "Mail queue is growing",
      text: "Was {prev}, now {queue}.",
    },
    "mail-queue-watch": {
      title: "Mail queue is growing",
      text: "{queue} messages in the queue.",
    },
    "mail-open": {
      title: "Mail listens on the street without a jail",
      text: "{kind} is open from outside ({ports}). fail2ban is there, but no mail jail. This is not proven spam — hygiene only.",
      do: "Add a postfix/dovecot jail to fail2ban. Orb44 does not install the jail.",
    },
    "mail-bans": {
      title: "fail2ban is cutting mail stuffing",
      text: "Jail {jail}: currently banned {banned}, still knocking {failed}. We do not read or send mail — jail counters only.",
      do: "This is someone else’s SMTP/IMAP stuffing, not a mailing from your queue. Check the jail and SASL. Orb44 does not touch mail.",
    },
    "vpn-weak": {
      title: "Old VPN on the machine",
      text: "{kind} listens on {ports}. The protocol is weak; we do not read keys or config.",
      do: "Remove PPTP/L2TP, keep WireGuard or OpenVPN. Orb44 does not switch VPN.",
    },
    "stuck-proc": {
      title: "Processes are stuck or zombie",
      text: "State D/Z/T: {who}. The machine is waiting on disk or dead workers, not “just high load”.",
      do: "Do not kill from the dashboard — it cannot. On the server: ps and disk, not the WAF. Orb44 does not touch processes.",
    },
    "stuck-proc-watch": {
      title: "Processes are stuck",
      text: "{who}",
    },
    "crypto-miner": {
      title: "Looks like a miner",
      text: "{who}. A known miner name, or almost 100% CPU with a tiny RSS — typical of someone else’s miner, not a legitimate java “overload”.",
      do: "On the server, stop the process and check how it appeared (crontab, docker, compromised SSH). Orb44 does not kill processes.",
    },
    "hot-proc-ram": {
      title: "A process is holding a lot of RAM",
      text: "{who}. “Overload” includes a top process from {floor} MB RSS (30% of RAM, 1 GB minimum). CPU is not the story here: load can be calm.",
      do: "This is not an attack and not 100% CPU. See what the process is and how much it actually needs. Orb44 does not restart it or cap memory.",
    },
    "hot-proc": {
      title: "A service is eating CPU or RAM",
      text: "Top without overall load overload: {who}. The worker is already pinned; the storefront may still answer.",
      do: "Look at that process (php-fpm, node, mysql). Orb44 does not restart it.",
    },
    conntrack: {
      title: "Connection table is almost full",
      text: "conntrack {used}/{max} ({pct}%). New sessions will start dropping — 502 from the street, a queue from inside.",
      do: "Find who is holding a pile of TCP. Do not open ports “to help”.",
    },
    "conntrack-watch": {
      title: "conntrack is almost full",
      text: "{pct}%",
    },
    backlog: {
      title: "The accept queue is overflowing",
      text: "Since the last pulse ListenOverflows +{overDelta}, ListenDrops +{dropDelta}. The service cannot take connections fast enough.",
      do: "More workers or less inbound. Orb44 does not raise limits.",
    },
    "backlog-watch": {
      title: "The accept queue is growing",
      text: "+{overDelta} overflows, +{dropDelta} drops since the last pulse.",
    },
    files: {
      title: "File descriptors are running out",
      text: "{pct}% of the limit is open ({used}/{max}). Typical “suddenly the socket will not open”.",
      do: "Who is holding files: the worker or a leak. Orb44 does not change ulimit.",
    },
    clock: {
      title: "Machine clock has drifted",
      text: "NTP offset {offset} s. TLS and Watch timestamps will start lying.",
      do: "Fix chrony/timesyncd. Orb44 does not set the time.",
    },
    "cgroup-oom": {
      title: "A container or cgroup is hitting memory",
      text: "cgroup oom={oom}, failcnt={failcnt}. This is a kernel counter, not journal.",
      do: "Container memory limit, not the WAF. Orb44 does not raise limits.",
    },
    "listen-swap": {
      title: "The process on 80/443 changed",
      text: "Was {from}, now {to}. The storefront binary was swapped or another server sat down next to it.",
      do: "Confirm who should listen on HTTPS. Orb44 does not roll the process back.",
    },
    "listen-swap-watch": {
      title: "The process on 80/443 changed",
      text: "Was {from}, now {to}.",
    },
    "listen-new": {
      title: "New service port on 0.0.0.0",
      text: "Appeared: {ports}. They were not there on the last pulse.",
    },
    "failed-unit": {
      title: "A systemd unit failed",
      text: "{units} failed to start.",
      do: "On the machine: systemctl status for that unit. Orb44 does not bring it up.",
    },
    "runtime-error": {
      title: "Errors on the machine",
      text: "{line}",
      do: "This is a journal / docker / kubectl / nginx tail you allowed at login. Orb44 does not fix it.",
    },
    "pulse-stale": {
      title: "Satellite is not answering",
      text: "No pulse for {ageMin} min (threshold {thresholdMin} min). The daemon on the machine is silent or could not reach the dashboard.",
    },
  },
  ru: {
    _no_top: "процесс в топе не виден",
    _ssh_password: "вход по паролю включён",
    _ssh_root: "root может зайти по SSH",
    _ssh_world: "порт 22 слушает всю сеть",
    "listen-leaked": {
      title: "Служебные порты отвечают и с улицы",
      text: "Машина слушает {names} на 0.0.0.0, и снимок с интернета на тех же портах получил ответ сервиса, не пустой SYN-ACK. Это уже не «файрвол, скорее всего, держит» — сокет открыт снаружи.",
      do: "Сначала закройте порт на файрволе панели и в docker-compose поставьте 127.0.0.1 перед номером. Orb44 файрвол сам не включает и compose не правит.",
    },
    "listen-open-held": {
      title: "Базы слушают сеть сервера, с улицы молчат",
      text: "Сейчас {names} принимают подключения с любого сетевого адреса этой машины. Снимок с интернета на этих портах не получил баннер сервиса — файрвол держит. Если порт откроют в панели VPS, до базы доберётся любой, не только ваш сайт.",
      do: BIND_DO_RU,
    },
    "listen-open": {
      title: "Базы слушают всю сеть сервера",
      text: "Сейчас {names} принимают подключения не только с программ на этой машине, а с любого её сетевого адреса. Из интернета их может быть не видно: файрвол на VPS эти порты, скорее всего, закрывает. Если порт откроют — до Redis или Postgres доберётся любой, не только ваш сайт.",
      do: BIND_DO_RU,
    },
    "origin-mismatch": {
      title: "Адрес машины не совпал со снимком",
      text: "На машине {machine}, снаружи A={street}. Другой ящик или серый щит.",
      do: "Сверьте DNS A с тем VPS, куда поставили сателлит. Если сайт за Cloudflare — это ожидаемо, не инцидент.",
    },
    "load-street": {
      title: "Нагрузка и открытый вход",
      text: "Машина под нагрузкой, снаружи открыт вход — похоже бьют во вход. Топ: {who}.",
      do: "Сначала вход на витрине, не процессы. Сателлит здесь только подтверждает, что CPU живой.",
    },
    "load-local": {
      title: "Машина тяжёлая, витрина тихая",
      text: "Нагрузка локальная, снаружи тихо — не атака витрины. Топ: {who}.",
      do: "Смотрите процесс в топе (воркер, docker). WAF тут ни при чём.",
    },
    stuffing: {
      title: "fail2ban копит баны, вход с улицы горячий",
      text: "Сейчас в бане {banned}. Пароли не подбираем — это чужой перебор, сателлит только считает.",
      do: "Смотрите fail2ban и форму входа на витрине. Orb44 пароли не перебирает.",
    },
    "stuffing-watch": {
      title: "Нагрузка и открытый вход",
      text: "Машина под нагрузкой, снаружи горячий вход — похоже бьют во вход, не локальный воркер. Топ: {who}. Пароли не подбираем.",
    },
    "stuffing-ssh": {
      title: "fail2ban копит баны SSH",
      text: "Было {from}, стало {to}. Чужой перебор SSH, не вход на витрину. Пароли не подбираем.",
    },
    "hardening-min": {
      title: "Минимум защиты не виден",
      text: "Нет включённого файрвола и нет fail2ban. Лишние порты и подбор SSH никто не режет.",
      do: "Включите ufw и fail2ban. Orb44 пакеты сам не ставит.",
    },
    "hardening-fw": {
      title: "Файрвол не виден",
      text: "Не нашлось включённого ufw, nftables или firewalld. Тогда оранжевые порты баз — это не «закрыто файрволом», а открыто в сеть сервера.",
      do: "Включите ufw и закройте лишние порты. Orb44 файрвол сам не включает.",
    },
    "hardening-ban": {
      title: "Нет защиты подбора SSH",
      text: "fail2ban или sshguard не запущены. Повторные попытки входа по SSH ничем не режутся.",
      do: "Поставьте и включите fail2ban. Orb44 пакеты сам не ставит.",
    },
    "hardening-ssh": {
      title: "SSH слабее, чем нужно",
      text: "{bits}. Пароли не подбираем — это живые настройки sshd, не /etc/shadow.",
      do: "В sshd: PasswordAuthentication no и PermitRootLogin no. Порт 22 лучше не светить всей сети. Orb44 sshd сам не правит.",
    },
    "hardening-docker": {
      title: "Docker API слушает сеть сервера",
      text: "Порт 2375 или 2376 принимает подключения не только с этой машины. С улицы его может закрывать файрвол, но сокет уже не loopback.",
      do: "Уберите публикацию Docker API наружу. Достаточно unix-сокета. Orb44 Docker сам не трогает.",
    },
    "hardening-reboot": {
      title: "Ядро ждет перезагрузки",
      text: "На диске есть /var/run/reboot-required — пакеты ядра встали, машина ещё на старом.",
      do: "Запланируйте reboot в окно. Orb44 сервер сам не перезагружает.",
    },
    "hardening-timesync": {
      title: "Часы машины не синхронизируются",
      text: "Не видно chrony, systemd-timesyncd или ntp. Кривые часы ломают TLS и разбор логов.",
      do: "Включите systemd-timesyncd или chrony. Orb44 пакеты сам не ставит.",
    },
    "hardening-lsm": {
      title: "Нет AppArmor и SELinux",
      text: "На Linux не видно ни AppArmor, ни enforcing SELinux. Это не дыра сама по себе, но процесс ничем не ограничен.",
      do: "На Ubuntu обычно достаточно apparmor. Orb44 LSM сам не включает.",
    },
    "hardening-disk": {
      title: "Диск почти полный",
      text: "Корневой раздел занят на {pct}%. Логи и апдейты начнут падать раньше, чем витрина.",
      do: "Почистите логи и неиспользуемые образы Docker. Orb44 файлы сам не удаляет.",
    },
    "hardening-oom": {
      title: "Ядро убивало процессы по памяти",
      text: "В vmstat oom_kill={oomKills}. Кто-то уже упирался в RAM.",
      do: "Смотрите топ по RAM и лимиты контейнеров. Orb44 процессы сам не убивает и не поднимает.",
    },
    "hardening-oom-flag": {
      title: "Ядро убивало процессы по памяти",
      text: "Пульс пометил OOM.",
      do: "Смотрите топ по RAM и лимиты контейнеров. Orb44 процессы сам не убивает и не поднимает.",
    },
    "ssh-fails": {
      title: "SSH с улицы стучится",
      text: "За {windowMin} мин в journal: Failed password {failed}, Invalid user {invalid}. IP не сохраняем.",
      do: "Ключи вместо пароля и fail2ban на sshd. Orb44 логины не перебирает и journal наружу не выгружает.",
    },
    "ssh-fails-watch": {
      title: "SSH Failed password пачками",
      text: "За {windowMin} мин Failed password {failed}. IP не сохраняем.",
    },
    "mail-relay": {
      title: "Похоже на открытый релей",
      text: "{kind}: mynetworks содержит 0.0.0.0/0. Чужой может слать спам через этот ящик. Очередь и письма не читаем.",
      do: "В postfix сузьте mynetworks до локальной сети и оставьте reject_unauth_destination. Orb44 postconf сам не правит.",
    },
    "mail-relay-watch": {
      title: "Открытый почтовый релей",
      text: "{kind}: mynetworks 0.0.0.0/0.",
    },
    "mail-queue": {
      title: "Почтовая очередь толстая",
      text: "{kind}: в очереди {queue} писем. Так бывает при рассылке или когда релей не принимает. Содержимое очереди не смотрим.",
      do: "На машине: postqueue -p / mailq — кто отправитель. Orb44 письма не шлёт и очередь не чистит.",
    },
    "mail-queue-grew": {
      title: "Почтовая очередь растёт",
      text: "Было {prev}, стало {queue}.",
    },
    "mail-queue-watch": {
      title: "Почтовая очередь растёт",
      text: "В очереди {queue} писем.",
    },
    "mail-open": {
      title: "Почта слушает улицу без jail",
      text: "{kind} открыт снаружи ({ports}). fail2ban есть, но почтового jail не видно. Это не доказанный спам — только гигиена.",
      do: "Добавьте jail postfix/dovecot в fail2ban. Orb44 jail сам не ставит.",
    },
    "mail-bans": {
      title: "fail2ban режет почтовый перебор",
      text: "Jail {jail}: сейчас в бане {banned}, ещё стучатся {failed}. Письма не читаем и не шлём — только счётчики jail.",
      do: "Это чужой перебор SMTP/IMAP, не рассылка с вашей очереди. Смотрите jail и SASL. Orb44 почту не трогает.",
    },
    "vpn-weak": {
      title: "Старый VPN на машине",
      text: "{kind} слушает {ports}. Протокол слабый, ключи и конфиг не читаем.",
      do: "Уберите PPTP/L2TP, оставьте WireGuard или OpenVPN. Orb44 VPN сам не переключает.",
    },
    "stuck-proc": {
      title: "Процессы зависли или зомби",
      text: "Состояние D/Z/T: {who}. Так машина стоит на диске или мёртвых воркерах, а не «просто высокая нагрузка».",
      do: "Не убивайте с кабинета — его нет. На сервере: ps и диск, не WAF. Orb44 процессы сам не трогает.",
    },
    "stuck-proc-watch": {
      title: "Процессы зависли",
      text: "{who}",
    },
    "crypto-miner": {
      title: "Похоже на майнер",
      text: "{who}. Имя из известного списка криптомайнеров или почти 100% CPU при маленьком RSS — типичный признак чужого майнера, не «Перегруз» легитимным java.",
      do: "На сервере остановите процесс и проверьте, как он появился (crontab, docker, скомпрометированный SSH). Orb44 процессы сам не убивает.",
    },
    "hot-proc-ram": {
      title: "Процесс держит много RAM",
      text: "{who}. В «Перегруз» попадает процесс из топа от {floor} МБ RSS (30% RAM, минимум 1 ГБ). CPU тут ни при чём: load может быть спокойным.",
      do: "Это не атака и не 100% процессора. Смотрите, что за процесс и сколько ему реально нужно. Orb44 его не рестартит и память не ограничивает.",
    },
    "hot-proc": {
      title: "Сервис жрёт CPU или RAM",
      text: "Топ без общей перегрузки load: {who}. Воркер уже упёрся, витрина может ещё отвечать.",
      do: "Смотрите этот процесс (php-fpm, node, mysql). Orb44 его не рестартит.",
    },
    conntrack: {
      title: "Таблица соединений почти полная",
      text: "conntrack {used}/{max} ({pct}%). Новые сессии начнут отбрасываться — с улицы это 502, изнутри это очередь.",
      do: "Ищите кто держит кучу TCP. Не открывайте порты «чтобы помогло».",
    },
    "conntrack-watch": {
      title: "conntrack почти полный",
      text: "{pct}%",
    },
    backlog: {
      title: "Очередь accept переполняется",
      text: "С прошлого пульса ListenOverflows +{overDelta}, ListenDrops +{dropDelta}. Сервис не успевает брать соединения.",
      do: "Больше воркеров или меньше входа. Orb44 лимиты сам не поднимает.",
    },
    "backlog-watch": {
      title: "Очередь accept растёт",
      text: "+{overDelta} overflows, +{dropDelta} drops с прошлого пульса.",
    },
    files: {
      title: "Заканчиваются файловые дескрипторы",
      text: "Открыто {pct}% лимита ({used}/{max}). Типичный «внезапно не открывается сокет».",
      do: "Кто держит файлы: воркер или утечка. Orb44 ulimit сам не меняет.",
    },
    clock: {
      title: "Часы машины уехали",
      text: "Смещение NTP {offset} с. TLS и метки Watch начнут врать.",
      do: "Почините chrony/timesyncd. Orb44 время сам не ставит.",
    },
    "cgroup-oom": {
      title: "Контейнер или cgroup упирается в память",
      text: "cgroup oom={oom}, failcnt={failcnt}. Это не journal — счётчик ядра.",
      do: "Лимит памяти контейнера, не WAF. Orb44 лимиты сам не поднимает.",
    },
    "listen-swap": {
      title: "На 80/443 сменился процесс",
      text: "Было {from}, стало {to}. Бинарь витрины подменили или рядом встал другой сервер.",
      do: "Сверьте, кто должен слушать HTTPS. Orb44 процесс сам не откатывает.",
    },
    "listen-swap-watch": {
      title: "На 80/443 сменился процесс",
      text: "Было {from}, стало {to}.",
    },
    "listen-new": {
      title: "Новый служебный порт на 0.0.0.0",
      text: "Появились {ports}. С прошлого пульса их не было.",
    },
    "failed-unit": {
      title: "Упал systemd-юнит",
      text: "{units} не запустился.",
      do: "На машине: systemctl status этого юнита. Orb44 его сам не поднимает.",
    },
    "runtime-error": {
      title: "Ошибки на машине",
      text: "{line}",
      do: "Это хвост журнала / docker / kubectl / nginx, который вы разрешили при login. Orb44 ничего не чинит.",
    },
    "pulse-stale": {
      title: "Сателлит не отвечает",
      text: "Пульса нет {ageMin} мин (порог {thresholdMin} мин). Демон на машине молчит или не достучался до кабинета.",
    },
  },
  es: {
    _no_top: "no se ve el proceso del top",
    _ssh_password: "el login por contraseña está activo",
    _ssh_root: "root puede entrar por SSH",
    _ssh_world: "el puerto 22 escucha en toda la red",
    "listen-leaked": {
      title: "Los puertos de servicio responden desde la calle",
      text: "La máquina escucha {names} en 0.0.0.0, y el snapshot de internet obtuvo el banner del servicio en esos puertos, no un SYN-ACK vacío. Ya no es “el firewall probablemente aguanta” — el socket está abierto fuera.",
      do: "Cierre primero el puerto en el firewall del panel y ponga 127.0.0.1 en docker-compose. Orb44 no activa el firewall ni edita compose.",
    },
    "listen-open-held": {
      title: "Las bases escuchan la red del servidor, en silencio desde la calle",
      text: "Ahora {names} aceptan conexiones desde cualquier dirección de esta máquina. El snapshot de internet no obtuvo banner en esos puertos — el firewall aguanta. Si abren el puerto en el panel del VPS, cualquiera llega a la base, no solo su sitio.",
      do: BIND_DO_ES,
    },
    "listen-open": {
      title: "Las bases de datos escuchan en toda la red del servidor",
      text: "Ahora {names} aceptan conexiones no solo de programas en esta máquina, sino de cualquier dirección de red suya. Desde internet puede no verse: el firewall del VPS suele cerrarlos. Si abren el puerto, cualquiera llega a Redis o Postgres, no solo su sitio.",
      do: BIND_DO_ES,
    },
    "origin-mismatch": {
      title: "La IP de la máquina no coincidió con el snapshot",
      text: "En la máquina {machine}, desde fuera A={street}. Otra caja o un escudo gris.",
      do: "Compruebe que el DNS A apunta al VPS donde instaló el satélite. Si el sitio está detrás de Cloudflare, es esperable — no es un incidente.",
    },
    "load-street": {
      title: "Carga y un login abierto",
      text: "La máquina está cargada y el login está abierto desde fuera — parece que golpean el login. Top: {who}.",
      do: "Empiece por el login de la tienda, no por los procesos. El satélite solo confirma que la CPU está viva.",
    },
    "load-local": {
      title: "La máquina está pesada, la tienda está callada",
      text: "La carga es local, desde fuera está quieto — no es un ataque a la tienda. Top: {who}.",
      do: "Mire el proceso del top (worker, docker). El WAF no pinta aquí.",
    },
    stuffing: {
      title: "fail2ban acumula baneos, el login de la calle está caliente",
      text: "Ahora en ban: {banned}. No adivinamos contraseñas — es fuerza bruta ajena; el satélite solo cuenta.",
      do: "Mire fail2ban y el formulario de login. Orb44 no prueba contraseñas.",
    },
    "stuffing-watch": {
      title: "Carga y un login abierto",
      text: "La máquina está cargada y el login está caliente desde fuera — parece que golpean el login, no un worker local. Top: {who}. No adivinamos contraseñas.",
    },
    "stuffing-ssh": {
      title: "fail2ban acumula baneos SSH",
      text: "Era {from}, ahora {to}. Fuerza bruta SSH de fuera, no el login de la tienda. No adivinamos contraseñas.",
    },
    "hardening-min": {
      title: "No se ve la protección mínima",
      text: "No hay firewall activo ni fail2ban. Nadie corta puertos de más ni el relleno de SSH.",
      do: "Active ufw y fail2ban en el host. Orb44 no instala paquetes.",
    },
    "hardening-fw": {
      title: "No se ve el firewall",
      text: "No hay ufw, nftables o firewalld activo. Entonces los puertos naranjas de bases no están “cerrados por el firewall”: están abiertos a la red del servidor.",
      do: "Active ufw y cierre puertos de más. Orb44 no activa el firewall.",
    },
    "hardening-ban": {
      title: "No hay protección ante fuerza bruta SSH",
      text: "fail2ban o sshguard no están en marcha. Los reintentos SSH no se cortan.",
      do: "Instale y active fail2ban. Orb44 no instala paquetes.",
    },
    "hardening-ssh": {
      title: "SSH está más débil de lo que debería",
      text: "{bits}. No adivinamos contraseñas — son ajustes vivos de sshd, no /etc/shadow.",
      do: "En sshd: PasswordAuthentication no y PermitRootLogin no. Mejor no exponer el puerto 22 a toda la red. Orb44 no edita sshd.",
    },
    "hardening-docker": {
      title: "La API de Docker escucha en la red del servidor",
      text: "El puerto 2375 o 2376 acepta conexiones no solo de esta máquina. El firewall de la calle puede ocultarlo, pero el socket ya no es loopback.",
      do: "Deje de publicar la API de Docker. Basta un socket unix. Orb44 no toca Docker.",
    },
    "hardening-reboot": {
      title: "El kernel espera un reinicio",
      text: "En disco está /var/run/reboot-required — llegaron paquetes del kernel y la máquina sigue en el viejo.",
      do: "Planifique un reboot en una ventana. Orb44 no reinicia el servidor.",
    },
    "hardening-timesync": {
      title: "El reloj de la máquina no se sincroniza",
      text: "No se ve chrony, systemd-timesyncd ni ntp. Un reloj torcido rompe TLS y los logs.",
      do: "Active systemd-timesyncd o chrony. Orb44 no instala paquetes.",
    },
    "hardening-lsm": {
      title: "No hay AppArmor ni SELinux",
      text: "En Linux no se ve AppArmor ni SELinux en enforcing. No es un agujero por sí solo, pero el proceso no está confinado.",
      do: "En Ubuntu suele bastar apparmor. Orb44 no activa LSM.",
    },
    "hardening-disk": {
      title: "El disco está casi lleno",
      text: "La raíz está al {pct}%. Los logs y las actualizaciones fallarán antes que la tienda.",
      do: "Limpie logs e imágenes Docker sin uso. Orb44 no borra archivos.",
    },
    "hardening-oom": {
      title: "El kernel mató procesos por memoria",
      text: "En vmstat oom_kill={oomKills}. Algo ya se estrelló contra la RAM.",
      do: "Mire el top de RAM y los límites del contenedor. Orb44 no mata ni levanta procesos.",
    },
    "hardening-oom-flag": {
      title: "El kernel mató procesos por memoria",
      text: "El pulso marcó OOM.",
      do: "Mire el top de RAM y los límites del contenedor. Orb44 no mata ni levanta procesos.",
    },
    "ssh-fails": {
      title: "SSH golpea desde la calle",
      text: "En {windowMin} min de journal: Failed password {failed}, Invalid user {invalid}. No guardamos IPs.",
      do: "Claves en vez de contraseña y fail2ban en sshd. Orb44 no prueba logins ni exporta el journal.",
    },
    "ssh-fails-watch": {
      title: "SSH Failed password a ráfagas",
      text: "En {windowMin} min Failed password {failed}. No guardamos IPs.",
    },
    "mail-relay": {
      title: "Parece un relé abierto",
      text: "{kind}: mynetworks contiene 0.0.0.0/0. Un extraño puede enviar spam por esta caja. No leemos la cola ni el correo.",
      do: "En postfix estreche mynetworks a la red local y deje reject_unauth_destination. Orb44 no edita postconf.",
    },
    "mail-relay-watch": {
      title: "Relé de correo abierto",
      text: "{kind}: mynetworks 0.0.0.0/0.",
    },
    "mail-queue": {
      title: "La cola de correo está gorda",
      text: "{kind}: {queue} mensajes en cola. Pasa en un envío o cuando el relé no acepta. No miramos el cuerpo de la cola.",
      do: "En la máquina: postqueue -p / mailq — quién envía. Orb44 no manda correo ni limpia la cola.",
    },
    "mail-queue-grew": {
      title: "La cola de correo crece",
      text: "Era {prev}, ahora {queue}.",
    },
    "mail-queue-watch": {
      title: "La cola de correo crece",
      text: "{queue} mensajes en cola.",
    },
    "mail-open": {
      title: "El correo escucha la calle sin jail",
      text: "{kind} está abierto desde fuera ({ports}). Hay fail2ban, pero no se ve jail de correo. No es spam demostrado — solo higiene.",
      do: "Añada jail postfix/dovecot en fail2ban. Orb44 no instala el jail.",
    },
    "mail-bans": {
      title: "fail2ban corta el relleno de correo",
      text: "Jail {jail}: ahora en ban {banned}, aún golpean {failed}. No leemos ni enviamos correo — solo contadores del jail.",
      do: "Es fuerza bruta SMTP/IMAP ajena, no un envío de su cola. Mire el jail y SASL. Orb44 no toca el correo.",
    },
    "vpn-weak": {
      title: "VPN viejo en la máquina",
      text: "{kind} escucha en {ports}. El protocolo es débil; no leemos claves ni config.",
      do: "Quite PPTP/L2TP, deje WireGuard u OpenVPN. Orb44 no cambia el VPN.",
    },
    "stuck-proc": {
      title: "Procesos colgados o zombi",
      text: "Estado D/Z/T: {who}. La máquina espera disco o workers muertos, no “solo carga alta”.",
      do: "No mate desde el panel — no puede. En el servidor: ps y disco, no el WAF. Orb44 no toca procesos.",
    },
    "stuck-proc-watch": {
      title: "Procesos colgados",
      text: "{who}",
    },
    "crypto-miner": {
      title: "Parece un minero",
      text: "{who}. Un nombre de minero conocido, o casi 100% CPU con RSS pequeño — típico de un minero ajeno, no un java legítimo “saturado”.",
      do: "En el servidor pare el proceso y vea cómo apareció (crontab, docker, SSH comprometido). Orb44 no mata procesos.",
    },
    "hot-proc-ram": {
      title: "Un proceso sostiene mucha RAM",
      text: "{who}. En “sobrecarga” entra un proceso del top desde {floor} MB RSS (30% de RAM, mínimo 1 GB). La CPU no pinta: el load puede estar calmado.",
      do: "No es un ataque ni el 100% de CPU. Mire qué proceso es y cuánta RAM necesita de verdad. Orb44 no lo reinicia ni limita la memoria.",
    },
    "hot-proc": {
      title: "Un servicio se come CPU o RAM",
      text: "Top sin sobrecarga general de load: {who}. El worker ya está clavado; la tienda aún puede responder.",
      do: "Mire ese proceso (php-fpm, node, mysql). Orb44 no lo reinicia.",
    },
    conntrack: {
      title: "La tabla de conexiones está casi llena",
      text: "conntrack {used}/{max} ({pct}%). Las sesiones nuevas empezarán a caer — 502 desde la calle, cola desde dentro.",
      do: "Busque quién sostiene un montón de TCP. No abra puertos “para ayudar”.",
    },
    "conntrack-watch": {
      title: "conntrack casi lleno",
      text: "{pct}%",
    },
    backlog: {
      title: "La cola accept se desborda",
      text: "Desde el último pulso ListenOverflows +{overDelta}, ListenDrops +{dropDelta}. El servicio no da abasto a coger conexiones.",
      do: "Más workers o menos entrada. Orb44 no sube límites.",
    },
    "backlog-watch": {
      title: "La cola accept crece",
      text: "+{overDelta} overflows, +{dropDelta} drops desde el último pulso.",
    },
    files: {
      title: "Se acaban los descriptores de archivo",
      text: "Abierto el {pct}% del límite ({used}/{max}). El típico “de pronto no abre el socket”.",
      do: "Quién sostiene archivos: el worker o una fuga. Orb44 no cambia ulimit.",
    },
    clock: {
      title: "El reloj de la máquina se fue",
      text: "Desfase NTP {offset} s. TLS y las marcas de Watch empezarán a mentir.",
      do: "Arregle chrony/timesyncd. Orb44 no pone la hora.",
    },
    "cgroup-oom": {
      title: "Un contenedor o cgroup se estrella contra la memoria",
      text: "cgroup oom={oom}, failcnt={failcnt}. No es journal — contador del kernel.",
      do: "Límite de memoria del contenedor, no el WAF. Orb44 no sube límites.",
    },
    "listen-swap": {
      title: "En 80/443 cambió el proceso",
      text: "Era {from}, ahora {to}. Cambiaron el binario de la tienda o se sentó otro servidor al lado.",
      do: "Confirme quién debe escuchar HTTPS. Orb44 no revierte el proceso.",
    },
    "listen-swap-watch": {
      title: "En 80/443 cambió el proceso",
      text: "Era {from}, ahora {to}.",
    },
    "listen-new": {
      title: "Puerto de servicio nuevo en 0.0.0.0",
      text: "Aparecieron {ports}. En el pulso anterior no estaban.",
    },
    "failed-unit": {
      title: "Falló una unidad systemd",
      text: "{units} no arrancó.",
      do: "En la máquina: systemctl status de esa unidad. Orb44 no la levanta.",
    },
    "runtime-error": {
      title: "Errores en la máquina",
      text: "{line}",
      do: "Es la cola de journal / docker / kubectl / nginx que permitió al hacer login. Orb44 no lo repara.",
    },
    "pulse-stale": {
      title: "El satélite no responde",
      text: "Sin pulso {ageMin} min (umbral {thresholdMin} min). El demonio en la máquina calla o no alcanzó el panel.",
    },
  },
  ko: {
    _no_top: "톱 프로세스가 보이지 않음",
    _ssh_password: "비밀번호 로그인이 켜져 있음",
    _ssh_root: "root가 SSH로 들어올 수 있음",
    _ssh_world: "포트 22가 네트워크 전체를 수신",
    "listen-leaked": {
      title: "서비스 포트가 밖에서도 응답합니다",
      text: "머신이 {names}를 0.0.0.0에서 듣고, 인터넷 스냅샷이 빈 SYN-ACK가 아니라 그 포트의 서비스 배너를 받았습니다. 이제 “방화벽이 막을 것”이 아닙니다 — 소켓이 밖으로 열려 있습니다.",
      do: "먼저 패널 방화벽에서 포트를 닫고 docker-compose에 127.0.0.1을 붙이세요. Orb44는 방화벽을 켜지 않고 compose도 고치지 않습니다.",
    },
    "listen-open-held": {
      title: "DB가 서버 네트워크를 수신, 밖에서는 조용함",
      text: "지금 {names}가 이 머신의 아무 주소에서나 연결을 받습니다. 인터넷 스냅샷은 그 포트에서 서비스 배너를 못 받았습니다 — 방화벽이 막고 있습니다. VPS 패널에서 포트를 열면 사이트만이 아니라 누구나 DB에 닿습니다.",
      do: BIND_DO_KO,
    },
    "listen-open": {
      title: "데이터베이스가 서버 네트워크 전체를 수신합니다",
      text: "지금 {names}가 이 머신 위 프로그램만이 아니라 모든 네트워크 주소에서 연결을 받습니다. 인터넷에서는 안 보일 수 있습니다: VPS 방화벽이 보통 닫습니다. 포트를 열면 Redis나 Postgres에 사이트만이 아니라 누구나 닿습니다.",
      do: BIND_DO_KO,
    },
    "origin-mismatch": {
      title: "머신 주소가 스냅샷과 다릅니다",
      text: "머신에서는 {machine}, 밖에서는 A={street}. 다른 상자이거나 회색 방패입니다.",
      do: "위성을 심은 VPS와 DNS A가 맞는지 보세요. 사이트가 Cloudflare 뒤면 예상된 일입니다 — 사고가 아닙니다.",
    },
    "load-street": {
      title: "부하와 열린 로그인",
      text: "머신이 부하를 받고 밖 로그인이 열려 있습니다 — 로그인을 두드리는 것으로 보입니다. 톱: {who}.",
      do: "프로세스보다 상점 로그인부터. 위성은 CPU가 살아 있는지만 확인합니다.",
    },
    "load-local": {
      title: "머신은 무거운데 매장은 조용함",
      text: "부하는 로컬이고 밖은 조용합니다 — 상점 공격이 아닙니다. 톱: {who}.",
      do: "톱의 프로세스(워커, docker)를 보세요. WAF와는 무관합니다.",
    },
    stuffing: {
      title: "fail2ban이 차단을 쌓고, 밖 로그인이 뜨거움",
      text: "지금 차단 {banned}. 비밀번호는 추측하지 않습니다 — 남의 대입이고 위성은 세기만 합니다.",
      do: "fail2ban과 상점 로그인 폼을 보세요. Orb44는 비밀번호를 때리지 않습니다.",
    },
    "stuffing-watch": {
      title: "부하와 열린 로그인",
      text: "머신이 부하를 받고 밖 로그인이 뜨겁습니다 — 로컬 워커가 아니라 로그인을 두드리는 것으로 보입니다. 톱: {who}. 비밀번호는 추측하지 않습니다.",
    },
    "stuffing-ssh": {
      title: "fail2ban이 SSH 차단을 쌓음",
      text: "이전 {from}, 지금 {to}. 상점 로그인이 아니라 밖 SSH 대입입니다. 비밀번호는 추측하지 않습니다.",
    },
    "hardening-min": {
      title: "기본 보호가 보이지 않음",
      text: "켜진 방화벽도 fail2ban도 없습니다. 여분 포트와 SSH 대입을 아무도 자르지 않습니다.",
      do: "호스트에서 ufw와 fail2ban을 켜세요. Orb44는 패키지를 설치하지 않습니다.",
    },
    "hardening-fw": {
      title: "방화벽이 보이지 않음",
      text: "켜진 ufw, nftables, firewalld가 없습니다. 그러면 주황 DB 포트는 “방화벽이 닫음”이 아니라 서버 네트워크에 열린 것입니다.",
      do: "ufw를 켜고 여분 포트를 닫으세요. Orb44는 방화벽을 켜지 않습니다.",
    },
    "hardening-ban": {
      title: "SSH 대입 보호가 없음",
      text: "fail2ban이나 sshguard가 안 돌아갑니다. SSH 재시도가 잘리지 않습니다.",
      do: "fail2ban을 설치하고 켜세요. Orb44는 패키지를 설치하지 않습니다.",
    },
    "hardening-ssh": {
      title: "SSH가 필요한 것보다 약함",
      text: "{bits}. 비밀번호는 추측하지 않습니다 — /etc/shadow가 아니라 살아있는 sshd 설정입니다.",
      do: "sshd에서 PasswordAuthentication no, PermitRootLogin no. 포트 22를 네트워크 전체에 드러내지 않는 편이 낫습니다. Orb44는 sshd를 고치지 않습니다.",
    },
    "hardening-docker": {
      title: "Docker API가 서버 네트워크를 수신",
      text: "포트 2375 또는 2376이 이 머신만이 아니라 연결을 받습니다. 밖 방화벽이 가릴 수는 있어도 소켓은 이미 루프백이 아닙니다.",
      do: "Docker API 공개를 끄세요. unix 소켓이면 됩니다. Orb44는 Docker를 건드리지 않습니다.",
    },
    "hardening-reboot": {
      title: "커널이 재부팅을 기다림",
      text: "디스크에 /var/run/reboot-required가 있습니다 — 커널 패키지는 올라갔고 머신은 아직 옛것입니다.",
      do: "점검 창에 reboot를 잡으세요. Orb44는 서버를 재부팅하지 않습니다.",
    },
    "hardening-timesync": {
      title: "머신 시계가 동기화되지 않음",
      text: "chrony, systemd-timesyncd, ntp가 보이지 않습니다. 틀린 시계는 TLS와 로그를 망칩니다.",
      do: "systemd-timesyncd 또는 chrony를 켜세요. Orb44는 패키지를 설치하지 않습니다.",
    },
    "hardening-lsm": {
      title: "AppArmor도 SELinux도 없음",
      text: "리눅스에서 AppArmor도 enforcing SELinux도 보이지 않습니다. 그 자체로 구멍은 아니지만 프로세스가 갇혀 있지 않습니다.",
      do: "우분투에서는 보통 apparmor면 됩니다. Orb44는 LSM을 켜지 않습니다.",
    },
    "hardening-disk": {
      title: "디스크가 거의 가득 참",
      text: "루트가 {pct}% 찼습니다. 상점보다 로그와 업데이트가 먼저 죽습니다.",
      do: "로그와 안 쓰는 Docker 이미지를 지우세요. Orb44는 파일을 지우지 않습니다.",
    },
    "hardening-oom": {
      title: "커널이 메모리 때문에 프로세스를 죽였음",
      text: "vmstat oom_kill={oomKills}. 이미 RAM에 부딪힌 적이 있습니다.",
      do: "RAM 톱과 컨테이너 한도를 보세요. Orb44는 프로세스를 죽이거나 올리지 않습니다.",
    },
    "hardening-oom-flag": {
      title: "커널이 메모리 때문에 프로세스를 죽였음",
      text: "펄스가 OOM을 표시했습니다.",
      do: "RAM 톱과 컨테이너 한도를 보세요. Orb44는 프로세스를 죽이거나 올리지 않습니다.",
    },
    "ssh-fails": {
      title: "밖에서 SSH가 두드림",
      text: "저널 {windowMin}분: Failed password {failed}, Invalid user {invalid}. IP는 저장하지 않습니다.",
      do: "비밀번호 대신 키, sshd에 fail2ban. Orb44는 로그인을 때리지 않고 저널을 내보내지 않습니다.",
    },
    "ssh-fails-watch": {
      title: "SSH Failed password가 몰림",
      text: "{windowMin}분 Failed password {failed}. IP는 저장하지 않습니다.",
    },
    "mail-relay": {
      title: "열린 릴레이로 보임",
      text: "{kind}: mynetworks에 0.0.0.0/0이 있습니다. 남이 이 상자로 스팸을 보낼 수 있습니다. 큐와 메일은 읽지 않습니다.",
      do: "postfix에서 mynetworks를 로컬 망으로 줄이고 reject_unauth_destination을 두세요. Orb44는 postconf를 고치지 않습니다.",
    },
    "mail-relay-watch": {
      title: "열린 메일 릴레이",
      text: "{kind}: mynetworks 0.0.0.0/0.",
    },
    "mail-queue": {
      title: "메일 큐가 두꺼움",
      text: "{kind}: 큐에 편지 {queue}통. 발송 중이거나 릴레이가 안 받을 때입니다. 큐 내용은 보지 않습니다.",
      do: "머신에서: postqueue -p / mailq — 보낸 이. Orb44는 메일을 보내지 않고 큐를 비우지 않습니다.",
    },
    "mail-queue-grew": {
      title: "메일 큐가 늘어남",
      text: "이전 {prev}, 지금 {queue}.",
    },
    "mail-queue-watch": {
      title: "메일 큐가 늘어남",
      text: "큐에 편지 {queue}통.",
    },
    "mail-open": {
      title: "메일이 jail 없이 밖을 수신",
      text: "{kind}가 밖에서 열려 있습니다 ({ports}). fail2ban은 있는데 메일 jail이 안 보입니다. 입증된 스팸이 아니라 위생입니다.",
      do: "fail2ban에 postfix/dovecot jail을 넣으세요. Orb44는 jail을 설치하지 않습니다.",
    },
    "mail-bans": {
      title: "fail2ban이 메일 대입을 자름",
      text: "Jail {jail}: 지금 차단 {banned}, 아직 두드림 {failed}. 메일은 읽지도 보내지도 않습니다 — jail 숫자만.",
      do: "당신 큐의 발송이 아니라 남의 SMTP/IMAP 대입입니다. jail과 SASL을 보세요. Orb44는 메일을 건드리지 않습니다.",
    },
    "vpn-weak": {
      title: "머신에 옛 VPN",
      text: "{kind}가 {ports}에서 수신합니다. 프로토콜이 약하고 키와 설정은 읽지 않습니다.",
      do: "PPTP/L2TP를 빼고 WireGuard나 OpenVPN을 두세요. Orb44는 VPN을 바꾸지 않습니다.",
    },
    "stuck-proc": {
      title: "프로세스가 멈추거나 좀비",
      text: "상태 D/Z/T: {who}. “그냥 부하”가 아니라 디스크나 죽은 워커에서 서 있습니다.",
      do: "대시보드에서 죽이지 마세요 — 할 수 없습니다. 서버에서 ps와 디스크, WAF가 아닙니다. Orb44는 프로세스를 건드리지 않습니다.",
    },
    "stuck-proc-watch": {
      title: "프로세스가 멈춤",
      text: "{who}",
    },
    "crypto-miner": {
      title: "채굴기로 보임",
      text: "{who}. 알려진 채굴기 이름이거나 RSS가 작은데 CPU 거의 100% — 정상 java “과부하”가 아니라 남의 채굴기 전형입니다.",
      do: "서버에서 프로세스를 멈추고 어떻게 생겼는지 보세요 (crontab, docker, 뚫린 SSH). Orb44는 프로세스를 죽이지 않습니다.",
    },
    "hot-proc-ram": {
      title: "프로세스가 RAM을 많이 붙잡고 있음",
      text: "{who}. “과부하”에는 톱 프로세스 RSS {floor} MB부터 들어갑니다 (RAM 30%, 최소 1 GB). CPU 이야기가 아닙니다: load는 평온할 수 있습니다.",
      do: "공격도 CPU 100%도 아닙니다. 무슨 프로세스인지, 실제로 얼마나 필요한지 보세요. Orb44는 재시작하거나 메모리를 제한하지 않습니다.",
    },
    "hot-proc": {
      title: "서비스가 CPU 또는 RAM을 먹음",
      text: "전체 load 과부하 없이 톱: {who}. 워커는 이미 막혔고 매장은 아직 응답할 수 있습니다.",
      do: "그 프로세스(php-fpm, node, mysql)를 보세요. Orb44는 재시작하지 않습니다.",
    },
    conntrack: {
      title: "연결 테이블이 거의 가득 참",
      text: "conntrack {used}/{max} ({pct}%). 새 세션이 버려지기 시작합니다 — 밖에서는 502, 안에서는 큐.",
      do: "TCP를 잔뜩 붙잡은 쪽을 찾으세요. “도우려고” 포트를 열지 마세요.",
    },
    "conntrack-watch": {
      title: "conntrack이 거의 가득 참",
      text: "{pct}%",
    },
    backlog: {
      title: "accept 큐가 넘침",
      text: "지난 펄스 이후 ListenOverflows +{overDelta}, ListenDrops +{dropDelta}. 서비스가 연결을 제때 받지 못합니다.",
      do: "워커를 늘리거나 유입을 줄이세요. Orb44는 한도를 올리지 않습니다.",
    },
    "backlog-watch": {
      title: "accept 큐가 늘어남",
      text: "지난 펄스 이후 +{overDelta} overflows, +{dropDelta} drops.",
    },
    files: {
      title: "파일 디스크립터가 바닥남",
      text: "한도의 {pct}%가 열려 있습니다 ({used}/{max}). “갑자기 소켓이 안 열림”의 전형입니다.",
      do: "파일을 붙잡은 쪽: 워커 또는 누수. Orb44는 ulimit을 바꾸지 않습니다.",
    },
    clock: {
      title: "머신 시계가 어긋남",
      text: "NTP 오차 {offset}초. TLS와 Watch 시각이 거짓말을 시작합니다.",
      do: "chrony/timesyncd를 고치세요. Orb44는 시각을 맞추지 않습니다.",
    },
    "cgroup-oom": {
      title: "컨테이너 또는 cgroup이 메모리에 부딪힘",
      text: "cgroup oom={oom}, failcnt={failcnt}. 저널이 아니라 커널 카운터입니다.",
      do: "컨테이너 메모리 한도, WAF가 아닙니다. Orb44는 한도를 올리지 않습니다.",
    },
    "listen-swap": {
      title: "80/443에서 프로세스가 바뀜",
      text: "이전 {from}, 지금 {to}. 상점 바이너리를 바꿨거나 옆에 다른 서버가 앉았습니다.",
      do: "누가 HTTPS를 들어야 하는지 확인하세요. Orb44는 프로세스를 되돌리지 않습니다.",
    },
    "listen-swap-watch": {
      title: "80/443에서 프로세스가 바뀜",
      text: "이전 {from}, 지금 {to}.",
    },
    "listen-new": {
      title: "0.0.0.0에 새 서비스 포트",
      text: "생김: {ports}. 지난 펄스에는 없었습니다.",
    },
    "failed-unit": {
      title: "systemd 유닛이 실패함",
      text: "{units}가 시작되지 않았습니다.",
      do: "머신에서: 그 유닛의 systemctl status. Orb44는 올리지 않습니다.",
    },
    "runtime-error": {
      title: "머신의 오류",
      text: "{line}",
      do: "로그인 때 허용한 journal / docker / kubectl / nginx 꼬리입니다. Orb44는 고치지 않습니다.",
    },
    "pulse-stale": {
      title: "위성이 응답하지 않음",
      text: "{ageMin}분 동안 펄스 없음 (임계 {thresholdMin}분). 머신 데몬이 조용하거나 대시보드에 닿지 못했습니다.",
    },
  },
};

function noteLang(raw) {
  const s = String(raw || "en").toLowerCase();
  return INSIDE_NOTE_LANGS.includes(s) ? s : "en";
}

function fill(s, vars) {
  if (s == null || s === "") return s;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== "" ? String(vars[k]) : ""));
}

function missingVars(tpl, vars) {
  return [...String(tpl || "").matchAll(/\{(\w+)\}/g)].some(([, k]) => vars[k] == null || vars[k] === "");
}

function sshBits(lang, vars) {
  const pack = INSIDE_NOTES[noteLang(lang)] || INSIDE_NOTES.en;
  const bits = [];
  if (vars.sshPassword) bits.push(pack._ssh_password);
  if (vars.sshRoot) bits.push(pack._ssh_root);
  if (vars.sshWorld) bits.push(pack._ssh_world);
  return bits.join(". ");
}

function withWho(lang, vars) {
  if (vars.who) return vars;
  const pack = INSIDE_NOTES[noteLang(lang)] || INSIDE_NOTES.en;
  return { ...vars, who: pack._no_top };
}

export function localizeInsideNote(note, lang = "en") {
  if (!note || typeof note !== "object") return note;
  const id = note.id || note.kind;
  if (!id) return { ...note };
  const l = noteLang(lang);
  const pack = INSIDE_NOTES[l] || INSIDE_NOTES.en;
  const tpl = pack[id] || INSIDE_NOTES.en[id];
  if (!tpl) return { ...note };
  let vars = { ...(note.vars || {}) };
  if (id === "hardening-ssh") vars = { ...vars, bits: sshBits(l, vars) };
  if (id === "load-street" || id === "load-local" || id === "stuffing-watch") vars = withWho(l, vars);
  const out = { ...note };
  out.title = missingVars(tpl.title, vars) && note.title ? note.title : fill(tpl.title, vars);
  out.text = missingVars(tpl.text, vars) && note.text ? note.text : fill(tpl.text, vars);
  if (tpl.do != null) {
    out.do = missingVars(tpl.do, vars) && note.do ? note.do : fill(tpl.do, vars);
  } else if (note.do != null) {
    out.do = fill(note.do, vars);
  }
  return out;
}

export function localizeInsideNotes(list, lang = "en") {
  return (Array.isArray(list) ? list : []).map((n) => localizeInsideNote(n, lang));
}

/** Canonical stored note: English title/text/do plus id/vars for later locale. */
export function insideNote(id, kind, vars = {}) {
  const loc = localizeInsideNote({ id, kind, vars }, "en");
  const row = { kind, id, vars, title: loc.title, text: loc.text };
  if (loc.do) row.do = loc.do;
  return row;
}
