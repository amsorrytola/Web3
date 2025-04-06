

fn main() {
    let mut s = String::new();
    for _ in 0..100 {
        s.push_str("extra");
        println!("length: {}, capacity: {}, pointer: {:p}", s.len(), s.capacity(), s.as_ptr());
    }
    
}