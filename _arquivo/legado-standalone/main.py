import webview
import os
import sys
import threading
import http.server
import socketserver
import socket


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except AttributeError:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


class SilentHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    base_dir = resource_path('.')
    port = find_free_port()

    handler = lambda *args, **kwargs: SilentHandler(*args, directory=base_dir, **kwargs)
    httpd = socketserver.TCPServer(('127.0.0.1', port), handler)

    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    webview.create_window(
        'Escala de Sobreaviso',
        f'http://127.0.0.1:{port}/Escala-SA.html',
        width=960,
        height=800,
        resizable=True,
        min_size=(640, 500),
    )
    webview.start()
    httpd.shutdown()
