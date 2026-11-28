//! En Windows, el icono de la 1.x dentro del `.exe`.
fn main() {
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../src-tauri/icons/icon.ico");
        if let Err(e) = res.compile() {
            println!("cargo:warning=sin icono en el .exe: {e}");
        }
    }
}
