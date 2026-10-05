package com.gym.system;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

public class LocalServer {

    private static final int PORT = 8765;

    private final Context context;
    private final File databaseFile;
    private SQLiteDatabase db;
    private ServerSocket serverSocket;
    private volatile boolean running = false;

    public LocalServer(Context context) {
        this.context = context.getApplicationContext();
        this.databaseFile = new File(this.context.getFilesDir(), "gym.db");
    }

    public void start() throws Exception {
        copyDatabaseIfNeeded();

        db = SQLiteDatabase.openDatabase(
                databaseFile.getAbsolutePath(),
                null,
                SQLiteDatabase.OPEN_READWRITE
        );

        running = true;
        serverSocket = new ServerSocket(PORT);

        Thread serverThread = new Thread(() -> {
            while (running) {
                try {
                    Socket socket = serverSocket.accept();
                    new Thread(() -> handleClient(socket)).start();
                } catch (Exception e) {
                    if (running) {
                        e.printStackTrace();
                    }
                }
            }
        });

        serverThread.setDaemon(true);
        serverThread.start();
    }

    public void stop() {
        running = false;

        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (Exception ignored) {
        }

        try {
            if (db != null && db.isOpen()) {
                db.close();
            }
        } catch (Exception ignored) {
        }
    }

    private void copyDatabaseIfNeeded() throws Exception {
        if (databaseFile.exists() && databaseFile.length() > 0) {
            return;
        }

        try (InputStream input =
                     context.getAssets().open("gym.db");
             OutputStream output =
                     context.openFileOutput("gym.db", Context.MODE_PRIVATE)) {

            byte[] buffer = new byte[8192];
            int count;

            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
        }
    }

    private void handleClient(Socket socket) {
        try (Socket s = socket) {

            s.setSoTimeout(15000);

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(
                            s.getInputStream(),
                            StandardCharsets.UTF_8
                    )
            );

            String requestLine = reader.readLine();

            if (requestLine == null || requestLine.isEmpty()) {
                return;
            }

            String[] requestParts = requestLine.split(" ");

            if (requestParts.length < 2) {
                return;
            }

            String method = requestParts[0].toUpperCase(Locale.US);
            String fullPath = requestParts[1];

            Map<String, String> headers = new HashMap<>();
            String line;

            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');

                if (colon > 0) {
                    String key = line.substring(0, colon)
                            .trim()
                            .toLowerCase(Locale.US);

                    String value = line.substring(colon + 1).trim();

                    headers.put(key, value);
                }
            }

            int contentLength = 0;

            try {
                contentLength = Integer.parseInt(
                        headers.getOrDefault("content-length", "0")
                );
            } catch (Exception ignored) {
            }

            String body = "";

            if (contentLength > 0) {
                char[] chars = new char[contentLength];
                int read = 0;

                while (read < contentLength) {
                    int n = reader.read(chars, read, contentLength - read);

                    if (n == -1) {
                        break;
                    }

                    read += n;
                }

                body = new String(chars, 0, read);
            }

            String path = fullPath;
            String query = "";

            int question = fullPath.indexOf('?');

            if (question >= 0) {
                path = fullPath.substring(0, question);
                query = fullPath.substring(question + 1);
            }

            path = URLDecoder.decode(path, "UTF-8");

            if ("OPTIONS".equals(method)) {
                sendResponse(
                        s,
                        204,
                        "text/plain; charset=utf-8",
                        new byte[0]
                );
                return;
            }

            if (path.startsWith("/api/")) {
                handleApi(
                        s,
                        method,
                        path,
                        query,
                        body
                );
            } else {
                handleStatic(s, path);
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void handleApi(
            Socket socket,
            String method,
            String path,
            String query,
            String body
    ) throws Exception {

        try {

            // ADMIN LOGIN
            if ("POST".equals(method) &&
                    "/api/admin/login".equals(path)) {

                JSONObject request = parseObject(body);
                String password = request.optString("password", "");

                if (password.isEmpty()) {
                    sendJson(
                            socket,
                            400,
                            error("Password is required.")
                    );
                    return;
                }

                if ("demo123".equals(password)) {
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put(
                            "message",
                            "Authentication successful."
                    );

                    sendJson(socket, 200, result);
                } else {
                    sendJson(
                            socket,
                            401,
                            error("Incorrect password.")
                    );
                }

                return;
            }

            // HEALTH
            if ("GET".equals(method) &&
                    "/api/health".equals(path)) {

                JSONArray members = getAllMembers();
                JSONArray attendance = getAllAttendance();

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put(
                        "message",
                        "Jeyo's Hardhit server is running."
                );
                result.put("members", members.length());
                result.put("attendance", attendance.length());

                sendJson(socket, 200, result);
                return;
            }

            // BACKUP
            if ("GET".equals(method) &&
                    "/api/admin/backup".equals(path)) {

                JSONObject backup = new JSONObject();
                backup.put("members", getAllMembers());
                backup.put("attendance", getAllAttendance());
                backup.put(
                        "exportedAt",
                        new Date().toInstant().toString()
                );

                sendJson(socket, 200, backup);
                return;
            }

            // RESTORE
            if ("POST".equals(method) &&
                    "/api/admin/restore".equals(path)) {

                JSONObject request = parseObject(body);

                if (request.has("members") &&
                        request.opt("members") instanceof JSONArray) {

                    JSONArray members =
                            request.getJSONArray("members");

                    for (int i = 0; i < members.length(); i++) {
                        JSONObject member =
                                members.getJSONObject(i);

                        String id = getMemberId(member);

                        if (id.isEmpty()) {
                            id = generateMemberId();
                            member.put("id", id);
                        }

                        saveMember(member);
                    }
                }

                if (request.has("attendance") &&
                        request.opt("attendance") instanceof JSONArray) {

                    JSONArray logs =
                            request.getJSONArray("attendance");

                    for (int i = 0; i < logs.length(); i++) {
                        JSONObject log =
                                logs.getJSONObject(i);

                        String id =
                                log.optString(
                                        "id",
                                        String.valueOf(
                                                System.currentTimeMillis()
                                        )
                                );

                        saveAttendance(log, id);
                    }
                }

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put(
                        "message",
                        "Data restored successfully."
                );

                sendJson(socket, 200, result);
                return;
            }

            // ALL MEMBERS
            if ("GET".equals(method) &&
                    "/api/members".equals(path)) {

                sendJson(
                        socket,
                        200,
                        getAllMembers()
                );

                return;
            }

            // MEMBER BY ID
            if ("GET".equals(method) &&
                    path.startsWith("/api/members/") &&
                    !path.endsWith("/regenerate-id")) {

                String id =
                        path.substring("/api/members/".length());

                JSONObject member = findMemberById(id);

                if (member == null) {
                    sendJson(
                            socket,
                            404,
                            error("Member not found.")
                    );
                } else {
                    sendJson(socket, 200, member);
                }

                return;
            }

            // CREATE MEMBER
            if ("POST".equals(method) &&
                    "/api/members".equals(path)) {

                JSONObject request = parseObject(body);

                String suppliedId =
                        request.optString("id", "");

                if (suppliedId.isEmpty()) {
                    suppliedId =
                            request.optString("memberId", "");
                }

                String memberId =
                        suppliedId.trim();

                if (memberId.isEmpty()) {
                    memberId = generateMemberId();
                }

                JSONObject existing =
                        findMemberById(memberId);

                JSONObject member;

                if (existing != null) {
                    member = merge(existing, request);
                    member.put("id", getMemberId(existing));

                    saveMember(member);

                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put(
                            "message",
                            "Member already existed. Member updated."
                    );
                    result.put("member", member);

                    sendJson(socket, 200, result);
                } else {
                    member = request;
                    member.put("id", memberId);

                    saveMember(member);

                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put(
                            "message",
                            "Member registered successfully."
                    );
                    result.put("member", member);

                    sendJson(socket, 201, result);
                }

                return;
            }

            // UPDATE MEMBER
            if (("PUT".equals(method) ||
                    "PATCH".equals(method)) &&
                    path.startsWith("/api/members/")) {

                String id =
                        path.substring("/api/members/".length());

                if (id.endsWith("/")) {
                    id = id.substring(0, id.length() - 1);
                }

                JSONObject oldMember =
                        findMemberById(id);

                if (oldMember == null) {
                    sendJson(
                            socket,
                            404,
                            error("Member not found.")
                    );
                    return;
                }

                JSONObject request = parseObject(body);
                JSONObject updated =
                        merge(oldMember, request);

                updated.put("id", getMemberId(oldMember));

                saveMember(updated);

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put(
                        "message",
                        "Member updated successfully."
                );
                result.put("member", updated);

                sendJson(socket, 200, result);
                return;
            }

            // REGENERATE MEMBER ID
            if ("POST".equals(method) &&
                    path.startsWith("/api/members/") &&
                    path.endsWith("/regenerate-id")) {

                String id =
                        path.substring(
                                "/api/members/".length(),
                                path.length() -
                                        "/regenerate-id".length()
                        );

                JSONObject oldMember =
                        findMemberById(id);

                if (oldMember == null) {
                    sendJson(
                            socket,
                            404,
                            error("Member not found.")
                    );
                    return;
                }

                String oldId = getMemberId(oldMember);
                String newId = generateMemberId();

                deleteMember(oldId);

                oldMember.put("id", newId);
                saveMember(oldMember);

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("oldId", oldId);
                result.put("newId", newId);
                result.put(
                        "message",
                        "Member ID regenerated successfully."
                );

                sendJson(socket, 200, result);
                return;
            }

            // DELETE MEMBER
            if ("DELETE".equals(method) &&
                    path.startsWith("/api/members/")) {

                String id =
                        path.substring("/api/members/".length());

                JSONObject member =
                        findMemberById(id);

                if (member == null) {
                    sendJson(
                            socket,
                            404,
                            error("Member not found.")
                    );
                    return;
                }

                deleteMember(getMemberId(member));

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put(
                        "message",
                        "Member deleted successfully."
                );
                result.put("member", member);

                sendJson(socket, 200, result);
                return;
            }

            // TODAY'S ATTENDANCE
            if ("GET".equals(method) &&
                    "/api/attendance/today".equals(path)) {

                String today =
                        formatDate(new Date());

                JSONArray logs = getAllAttendance();
                JSONArray result = new JSONArray();

                for (int i = 0; i < logs.length(); i++) {

                    JSONObject log =
                            logs.getJSONObject(i);

                    String logDate =
                            log.optString("date", "");

                    if (logDate.isEmpty() &&
                            log.has("timestamp")) {

                        try {
                            logDate =
                                    formatDate(
                                            new Date(
                                                    log.getLong(
                                                            "timestamp"
                                                    )
                                            )
                                    );
                        } catch (Exception ignored) {
                        }
                    }

                    if (!today.equals(logDate)) {
                        continue;
                    }

                    String memberId =
                            log.optString(
                                    "memberId",
                                    log.optString(
                                            "member_id",
                                            ""
                                    )
                            );

                    JSONObject member =
                            findMemberById(memberId);

                    if (member == null) {
                        member = new JSONObject();
                    }

                    JSONObject item = new JSONObject();

                    String finalMemberId =
                            getMemberId(member);

                    if (finalMemberId.isEmpty()) {
                        finalMemberId = memberId;
                    }

                    item.put("id", finalMemberId);
                    item.put("memberId", finalMemberId);

                    item.put(
                            "name",
                            member.optString(
                                    "name",
                                    log.optString(
                                            "name",
                                            "Unknown Member"
                                    )
                            )
                    );

                    item.put(
                            "photo",
                            member.optString(
                                    "photo",
                                    log.optString(
                                            "photo",
                                            "https://via.placeholder.com/50"
                                    )
                            )
                    );

                    item.put(
                            "status",
                            member.optString(
                                    "status",
                                    log.optString(
                                            "status",
                                            getMembershipStatus(member)
                                    )
                            )
                    );

                    item.put(
                            "time",
                            log.optString(
                                    "time",
                                    formatTime(new Date())
                            )
                    );

                    if (log.has("timestamp")) {
                        item.put(
                                "timestamp",
                                log.optLong("timestamp")
                        );
                    } else {
                        item.put("timestamp", JSONObject.NULL);
                    }

                    result.put(item);
                }

                JSONArray reversed = new JSONArray();

                for (int i = result.length() - 1;
                     i >= 0;
                     i--) {
                    reversed.put(result.get(i));
                }

                sendJson(socket, 200, reversed);
                return;
            }

            // ATTENDANCE
            if ("GET".equals(method) &&
                    "/api/attendance".equals(path)) {

                Map<String, String> params =
                        parseQuery(query);

                String requestedDate =
                        params.get("date");

                JSONArray logs = getAllAttendance();

                if (requestedDate != null &&
                        !requestedDate.isEmpty()) {

                    JSONArray filtered =
                            new JSONArray();

                    for (int i = 0;
                         i < logs.length();
                         i++) {

                        JSONObject log =
                                logs.getJSONObject(i);

                        if (requestedDate.equals(
                                log.optString(
                                        "date",
                                        ""
                                ))) {
                            filtered.put(log);
                        }
                    }

                    sendJson(socket, 200, filtered);
                } else {
                    sendJson(socket, 200, logs);
                }

                return;
            }

            // QR SCAN
            if ("POST".equals(method) &&
                    "/api/attendance/scan".equals(path)) {

                JSONObject request =
                        parseObject(body);

                String raw =
                        request.optString(
                                "qrCode",
                                request.optString(
                                        "id",
                                        request.optString(
                                                "memberId",
                                                request.optString(
                                                        "member_id",
                                                        ""
                                                )
                                        )
                                )
                        );

                if (raw.isEmpty()) {
                    sendJson(
                            socket,
                            400,
                            error("Invalid scan input.")
                    );
                    return;
                }

                JSONObject member =
                        findMemberByScanInput(raw);

                if (member == null) {
                    sendJson(
                            socket,
                            404,
                            error(
                                    "Member matching \"" +
                                            raw +
                                            "\" not found."
                            )
                    );
                    return;
                }

                Date now = new Date();

                String memberId =
                        getMemberId(member);

                String time =
                        formatTime(now);

                String date =
                        formatDate(now);

                JSONObject log = new JSONObject();

                log.put(
                        "id",
                        System.currentTimeMillis()
                );
                log.put("memberId", memberId);
                log.put(
                        "name",
                        member.optString(
                                "name",
                                "Unknown Member"
                        )
                );
                log.put(
                        "photo",
                        member.optString(
                                "photo",
                                "https://via.placeholder.com/50"
                        )
                );
                log.put(
                        "status",
                        getMembershipStatus(member)
                );
                log.put(
                        "timestamp",
                        now.getTime()
                );
                log.put("date", date);
                log.put("time", time);

                saveAttendance(
                        log,
                        String.valueOf(
                                log.getLong("id")
                        )
                );

                JSONObject result = new JSONObject();

                result.put("success", true);
                result.put("id", memberId);
                result.put("memberId", memberId);
                result.put(
                        "name",
                        member.optString(
                                "name",
                                "Unknown Member"
                        )
                );
                result.put(
                        "photo",
                        member.optString(
                                "photo",
                                "https://via.placeholder.com/50"
                        )
                );
                result.put(
                        "status",
                        getMembershipStatus(member)
                );
                result.put("time", time);
                result.put(
                        "timestamp",
                        now.getTime()
                );

                sendJson(socket, 201, result);
                return;
            }

            // MANUAL ATTENDANCE
            if ("POST".equals(method) &&
                    "/api/attendance".equals(path)) {

                JSONObject request =
                        parseObject(body);

                Date now = new Date();

                long timestamp =
                        request.has("timestamp")
                                ? request.optLong(
                                        "timestamp",
                                        now.getTime()
                                )
                                : now.getTime();

                String date =
                        request.optString(
                                "date",
                                formatDate(
                                        new Date(timestamp)
                                )
                        );

                String time =
                        request.optString(
                                "time",
                                formatTime(
                                        new Date(timestamp)
                                )
                        );

                JSONObject log = new JSONObject();

                log.put(
                        "id",
                        System.currentTimeMillis()
                );
                log.put(
                        "memberId",
                        request.optString(
                                "memberId",
                                request.optString(
                                        "member_id",
                                        request.optString(
                                                "id",
                                                ""
                                        )
                                )
                        )
                );
                log.put(
                        "name",
                        request.optString(
                                "name",
                                ""
                        )
                );
                log.put(
                        "photo",
                        request.optString(
                                "photo",
                                ""
                        )
                );
                log.put(
                        "status",
                        request.optString(
                                "status",
                                "Active"
                        )
                );
                log.put("timestamp", timestamp);
                log.put("date", date);
                log.put("time", time);

                if (request.has("daysLeft")) {
                    log.put(
                            "daysLeft",
                            request.get("daysLeft")
                    );
                }

                saveAttendance(
                        log,
                        String.valueOf(
                                log.getLong("id")
                        )
                );

                sendJson(socket, 201, log);
                return;
            }

            // DELETE ATTENDANCE
            if ("DELETE".equals(method) &&
                    path.startsWith("/api/attendance/")) {

                String id =
                        path.substring(
                                "/api/attendance/".length()
                        );

                JSONObject found = null;

                JSONArray logs =
                        getAllAttendance();

                for (int i = 0;
                     i < logs.length();
                     i++) {

                    JSONObject log =
                            logs.getJSONObject(i);

                    if (id.equals(
                            log.optString(
                                    "id",
                                    ""
                            )
                    )) {
                        found = log;
                        break;
                    }
                }

                if (found == null) {
                    sendJson(
                            socket,
                            404,
                            error(
                                    "Attendance log not found."
                            )
                    );
                    return;
                }

                deleteAttendance(id);

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put(
                        "message",
                        "Attendance log deleted."
                );
                result.put("log", found);

                sendJson(socket, 200, result);
                return;
            }

            // PRINTING IS HANDLED SEPARATELY LATER
            if ("POST".equals(method) &&
                    "/api/print/receipt".equals(path)) {

                sendJson(
                        socket,
                        501,
                        error(
                                "Android receipt printing will be added separately."
                        )
                );
                return;
            }

            sendJson(
                    socket,
                    404,
                    error("API endpoint not found.")
            );

        } catch (Exception e) {

            e.printStackTrace();

            sendJson(
                    socket,
                    500,
                    error(
                            "Server error: " +
                                    e.getMessage()
                    )
            );
        }
    }

    private void handleStatic(
            Socket socket,
            String path
    ) throws Exception {

        String clientIp =
                socket.getInetAddress().getHostAddress();

        boolean localConnection =
                "127.0.0.1".equals(clientIp) ||
                "::1".equals(clientIp) ||
                "0:0:0:0:0:0:0:1".equals(clientIp) ||
                "::ffff:127.0.0.1".equals(clientIp);

        if (path.equals("/") ||
                path.isEmpty() ||
                path.equals("/index.html")) {

            if (localConnection) {
                path = "/index.html";
            } else {
                path = "/admin.html";
            }
        }

        while (path.startsWith("/")) {
            path = path.substring(1);
        }

        if (path.contains("..")) {
            sendResponse(
                    socket,
                    403,
                    "text/plain; charset=utf-8",
                    "Forbidden".getBytes(
                            StandardCharsets.UTF_8
                    )
            );
            return;
        }

        String assetPath = "public/" + path;

        try (InputStream input =
                     context.getAssets().open(assetPath)) {

            ByteArrayOutputStream output =
                    new ByteArrayOutputStream();

            byte[] buffer = new byte[8192];
            int count;

            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }

            byte[] data = output.toByteArray();

            sendResponse(
                    socket,
                    200,
                    mimeType(path),
                    data
            );

        } catch (Exception e) {

            sendResponse(
                    socket,
                    404,
                    "text/plain; charset=utf-8",
                    "Not Found".getBytes(
                            StandardCharsets.UTF_8
                    )
            );
        }
    }

    private JSONArray getAllMembers() {

        JSONArray result = new JSONArray();

        Cursor cursor =
                db.rawQuery(
                        "SELECT data FROM members",
                        null
                );

        try {
            while (cursor.moveToNext()) {
                try {
                    result.put(
                            new JSONObject(
                                    cursor.getString(0)
                            )
                    );
                } catch (Exception ignored) {
                }
            }
        } finally {
            cursor.close();
        }

        return result;
    }

    private JSONArray getAllAttendance() {

        JSONArray result = new JSONArray();

        Cursor cursor =
                db.rawQuery(
                        "SELECT data FROM attendance",
                        null
                );

        try {
            while (cursor.moveToNext()) {
                try {
                    result.put(
                            new JSONObject(
                                    cursor.getString(0)
                            )
                    );
                } catch (Exception ignored) {
                }
            }
        } finally {
            cursor.close();
        }

        return result;
    }

    private JSONObject findMemberById(String id) {

        String wanted =
                normalizeId(id);

        if (wanted.isEmpty()) {
            return null;
        }

        JSONArray members =
                getAllMembers();

        for (int i = 0;
             i < members.length();
             i++) {

            try {
                JSONObject member =
                        members.getJSONObject(i);

                if (wanted.equals(
                        normalizeId(
                                getMemberId(member)
                        )
                )) {
                    return member;
                }

            } catch (Exception ignored) {
            }
        }

        return null;
    }

    private JSONObject findMemberByScanInput(
            String input
    ) {

        String wanted =
                normalizeId(input);

        if (wanted.isEmpty()) {
            return null;
        }

        JSONArray members =
                getAllMembers();

        for (int i = 0;
             i < members.length();
             i++) {

            try {
                JSONObject member =
                        members.getJSONObject(i);

                String id =
                        normalizeId(
                                getMemberId(member)
                        );

                String qr =
                        normalizeId(
                                member.optString(
                                        "qrCode",
                                        ""
                                )
                        );

                if (wanted.equals(id) ||
                        (!qr.isEmpty() &&
                                wanted.equals(qr))) {

                    return member;
                }

            } catch (Exception ignored) {
            }
        }

        return null;
    }

    private void saveMember(
            JSONObject member
    ) {

        String id =
                getMemberId(member);

        if (id.isEmpty()) {
            return;
        }

        SQLiteStatement statement =
                db.compileStatement(
                        "INSERT OR REPLACE INTO " +
                                "members (id, data) " +
                                "VALUES (?, ?)"
                );

        try {
            statement.bindString(1, id);
            statement.bindString(
                    2,
                    member.toString()
            );
            statement.executeInsert();
        } finally {
            statement.close();
        }
    }

    private void deleteMember(
            String id
    ) {

        SQLiteStatement statement =
                db.compileStatement(
                        "DELETE FROM members WHERE id = ?"
                );

        try {
            statement.bindString(1, id);
            statement.executeUpdateDelete();
        } finally {
            statement.close();
        }
    }

    private void saveAttendance(
            JSONObject log,
            String id
    ) {

        String memberId =
                log.optString(
                        "memberId",
                        log.optString(
                                "member_id",
                                ""
                        )
                );

        String date =
                log.optString(
                        "date",
                        ""
                );

        SQLiteStatement statement =
                db.compileStatement(
                        "INSERT OR REPLACE INTO " +
                                "attendance " +
                                "(id, member_id, date, data) " +
                                "VALUES (?, ?, ?, ?)"
                );

        try {
            statement.bindString(1, id);
            statement.bindString(2, memberId);
            statement.bindString(3, date);
            statement.bindString(
                    4,
                    log.toString()
            );
            statement.executeInsert();
        } finally {
            statement.close();
        }
    }

    private void deleteAttendance(
            String id
    ) {

        SQLiteStatement statement =
                db.compileStatement(
                        "DELETE FROM attendance WHERE id = ?"
                );

        try {
            statement.bindString(1, id);
            statement.executeUpdateDelete();
        } finally {
            statement.close();
        }
    }

    private JSONObject merge(
            JSONObject original,
            JSONObject updates
    ) {

        JSONObject result;

        try {
            result =
                    new JSONObject(
                            original.toString()
                    );

            java.util.Iterator<String> keys =
                    updates.keys();

            while (keys.hasNext()) {
                String key = keys.next();

                if ("id".equals(key)) {
                    continue;
                }

                result.put(
                        key,
                        updates.get(key)
                );
            }

        } catch (Exception e) {
            return original;
        }

        return result;
    }

    private String getMemberId(
            JSONObject member
    ) {

        if (member == null) {
            return "";
        }

        String id =
                member.optString("id", "");

        if (!id.isEmpty()) {
            return id;
        }

        id =
                member.optString(
                        "memberId",
                        ""
                );

        if (!id.isEmpty()) {
            return id;
        }

        return member.optString(
                "member_id",
                ""
        );
    }

    private String normalizeId(
            String value
    ) {

        if (value == null) {
            return "";
        }

        String raw =
                value.trim();

        try {
            if (raw.startsWith("{") &&
                    raw.endsWith("}")) {

                JSONObject object =
                        new JSONObject(raw);

                String extracted =
                        object.optString(
                                "id",
                                object.optString(
                                        "memberId",
                                        object.optString(
                                                "member_id",
                                                raw
                                        )
                                )
                        );

                raw = extracted;
            }
        } catch (Exception ignored) {
        }

        return raw
                .toLowerCase(Locale.US)
                .replaceAll(
                        "[^a-z0-9]",
                        ""
                )
                .trim();
    }

    private String generateMemberId() {

        Random random =
                new Random();

        String id;

        do {
            id =
                    "JH" +
                            (100000 +
                                    random.nextInt(
                                            900000
                                    ));

        } while (findMemberById(id) != null);

        return id;
    }

    private String getMembershipStatus(
            JSONObject member
    ) {

        String expiry =
                member.optString(
                        "expiry",
                        member.optString(
                                "dateDue",
                                member.optString(
                                        "date_due",
                                        member.optString(
                                                "datedue",
                                                ""
                                        )
                                )
                        )
                );

        if (expiry.isEmpty()) {
            return "Active";
        }

        try {
            Date expiryDate =
                    parseDate(expiry);

            if (expiryDate == null) {
                return "Active";
            }

            String today =
                    formatDate(
                            new Date()
                    );

            String expiryDay =
                    formatDate(expiryDate);

            if (expiryDay.compareTo(today) < 0) {
                return "Expired";
            }

        } catch (Exception ignored) {
        }

        return "Active";
    }

    private Date parseDate(
            String value
    ) {

        String clean =
                value.trim();

        if (clean.contains("T")) {
            clean =
                    clean.substring(
                            0,
                            clean.indexOf("T")
                    );
        }

        String[] formats = {
                "yyyy-MM-dd",
                "MM/dd/yyyy",
                "yyyy/MM/dd"
        };

        for (String format : formats) {
            try {
                SimpleDateFormat sdf =
                        new SimpleDateFormat(
                                format,
                                Locale.US
                        );

                sdf.setLenient(false);

                return sdf.parse(clean);

            } catch (Exception ignored) {
            }
        }

        return null;
    }

    private String formatDate(
            Date date
    ) {

        return new SimpleDateFormat(
                "yyyy-MM-dd",
                Locale.US
        ).format(date);
    }

    private String formatTime(
            Date date
    ) {

        return new SimpleDateFormat(
                "hh:mm a",
                Locale.US
        ).format(date);
    }

    private JSONObject parseObject(
            String body
    ) throws Exception {

        if (body == null ||
                body.trim().isEmpty()) {

            return new JSONObject();
        }

        return new JSONObject(body);
    }

    private JSONObject error(
            String message
    ) throws Exception {

        JSONObject result =
                new JSONObject();

        result.put("success", false);
        result.put("message", message);

        return result;
    }

    private Map<String, String> parseQuery(
            String query
    ) throws Exception {

        Map<String, String> result =
                new HashMap<>();

        if (query == null ||
                query.isEmpty()) {
            return result;
        }

        String[] parts =
                query.split("&");

        for (String part : parts) {

            String[] pair =
                    part.split("=", 2);

            String key =
                    URLDecoder.decode(
                            pair[0],
                            "UTF-8"
                    );

            String value =
                    pair.length > 1
                            ? URLDecoder.decode(
                                    pair[1],
                                    "UTF-8"
                            )
                            : "";

            result.put(key, value);
        }

        return result;
    }

    private void sendJson(
            Socket socket,
            int status,
            Object object
    ) throws Exception {

        byte[] data =
                object.toString()
                        .getBytes(
                                StandardCharsets.UTF_8
                        );

        sendResponse(
                socket,
                status,
                "application/json; charset=utf-8",
                data
        );
    }

    private void sendResponse(
            Socket socket,
            int status,
            String contentType,
            byte[] data
    ) throws Exception {

        OutputStream output =
                socket.getOutputStream();

        String statusText =
                statusText(status);

        String headers =
                "HTTP/1.1 " +
                        status +
                        " " +
                        statusText +
                        "\r\n" +
                        "Content-Type: " +
                        contentType +
                        "\r\n" +
                        "Content-Length: " +
                        data.length +
                        "\r\n" +
                        "Cache-Control: no-cache\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Access-Control-Allow-Headers: Content-Type\r\n" +
                        "Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\n" +
                        "Connection: close\r\n" +
                        "\r\n";

        output.write(
                headers.getBytes(
                        StandardCharsets.UTF_8
                )
        );

        output.write(data);
        output.flush();
    }

    private String statusText(
            int status
    ) {

        switch (status) {
            case 200:
                return "OK";
            case 201:
                return "Created";
            case 204:
                return "No Content";
            case 400:
                return "Bad Request";
            case 401:
                return "Unauthorized";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 500:
                return "Internal Server Error";
            case 501:
                return "Not Implemented";
            default:
                return "OK";
        }
    }

    private String mimeType(
            String path
    ) {

        String lower =
                path.toLowerCase(Locale.US);

        if (lower.endsWith(".html")) {
            return "text/html; charset=utf-8";
        }

        if (lower.endsWith(".css")) {
            return "text/css; charset=utf-8";
        }

        if (lower.endsWith(".js")) {
            return "application/javascript; charset=utf-8";
        }

        if (lower.endsWith(".json")) {
            return "application/json; charset=utf-8";
        }

        if (lower.endsWith(".png")) {
            return "image/png";
        }

        if (lower.endsWith(".jpg") ||
                lower.endsWith(".jpeg")) {
            return "image/jpeg";
        }

        if (lower.endsWith(".gif")) {
            return "image/gif";
        }

        if (lower.endsWith(".svg")) {
            return "image/svg+xml";
        }

        if (lower.endsWith(".ico")) {
            return "image/x-icon";
        }

        if (lower.endsWith(".woff")) {
            return "font/woff";
        }

        if (lower.endsWith(".woff2")) {
            return "font/woff2";
        }

        return "application/octet-stream";
    }
}
