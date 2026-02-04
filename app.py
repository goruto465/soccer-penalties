from flask import Flask, render_template, request, jsonify, g
import sqlite3
import os
from datetime import datetime

DB_PATH = "highscores.db"

app = Flask(__name__, static_folder="static", template_folder="templates")

def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        need_init = not os.path.exists(DB_PATH)
        db = g._database = sqlite3.connect(DB_PATH)
        if need_init:
            init_db(db)
    return db

def init_db(db):
    cur = db.cursor()
    cur.execute(
        """
        CREATE TABLE highscores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            score INTEGER NOT NULL,
            attempts INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    db.commit()

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/highscores", methods=["GET"])
def get_highscores():
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT name, score, attempts, created_at FROM highscores ORDER BY score DESC, created_at ASC LIMIT 20")
    rows = cur.fetchall()
    result = [{"name": r[0], "score": r[1], "attempts": r[2], "created_at": r[3]} for r in rows]
    return jsonify(result)

@app.route("/api/highscores", methods=["POST"])
def post_highscore():
    data = request.get_json()
    name = data.get("name", "Anon")[:50]
    score = int(data.get("score", 0))
    attempts = int(data.get("attempts", 0))
    db = get_db()
    cur = db.cursor()
    cur.execute("INSERT INTO highscores (name, score, attempts, created_at) VALUES (?, ?, ?, ?)",
                (name, score, attempts, datetime.utcnow().isoformat()))
    db.commit()
    return jsonify({"status": "ok"}), 201

if __name__ == "__main__":
    # production-friendly: bind to 0.0.0.0 and read PORT env var
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)