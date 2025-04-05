fn merge_sort(mut arr: Vec<i32>) -> Vec<i32> {
    println!("Sorting: {:?}", arr);
    let len = arr.len();
    println!("Length: {}", len);
    if len <= 1 {
        return arr;
    }
    let mid = len / 2;
    println!("Mid: {}", mid);
    let left = merge_sort(arr[..mid].to_vec());
    println!("Left: {:?}", left);
    let right = merge_sort(arr[mid..].to_vec());
    println!("Right: {:?}", right);
     
    println!("Merging: {:?} and {:?}", left, right);
    merge(left, right)
}

fn merge(left: Vec<i32>, right: Vec<i32>) -> Vec<i32> {

    let mut result = Vec::with_capacity(left.len() + right.len());
    println!("result: {:?}", result);

    let mut i = 0;
    println!("i: {}", i);
    let mut j = 0;
    println!("j: {}", j);

    while i < left.len() && j < right.len() {
        if left[i] <= right[j] {
            println!("Adding left[{}]: {}", i, left[i]);
            result.push(left[i]);
            i += 1;
            println!("i: {}", i);
        } else {
            println!("Adding right[{}]: {}", j, right[j]);
            result.push(right[j]);

            j += 1;
            println!("j: {}", j);
        }
    }

    // Append remaining elements
    result.extend_from_slice(&left[i..]);
    println!("Appending remaining left: {:?}", &left[i..]);
    result.extend_from_slice(&right[j..]);
    println!("Appending remaining right: {:?}", &right[j..]);
    println!("Merged result: {:?}", result);

    result
}

fn main() {
    let arr = vec![38, 27, 43, 3, 9, 82, 10];
    let sorted_arr = merge_sort(arr);
    println!("{:?}", sorted_arr);
}